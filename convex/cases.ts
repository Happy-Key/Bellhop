import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { currentEvidence, logActivity, recomputeAnalysis, recordStatement } from "./model";
import { transactionFields } from "./validators";
import { DEMO_CUSTOMER_LABEL } from "../lib/fixtures/demo";
import { applyPersonaOrigins } from "./personas";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query("cases").order("desc").take(50);
    return cases.map((c) => {
      const analysis = c.analysis as { stage?: string; questions?: { audience: string }[]; recommendation?: { action: string } } | null;
      return {
        _id: c._id,
        title: c.title,
        createdAt: c.createdAt,
        stage: analysis?.stage ?? "intake",
        customerLabel: c.customerLabel,
        demoPersonaId: c.demoPersonaId ?? null,
        recommendation: analysis?.recommendation?.action ?? null,
        /** Questions waiting on the customer (the /call page shows which cases need a call back). */
        openCustomerQuestions: analysis?.questions?.filter((q) => q.audience === "customer").length ?? 0,
      };
    });
  },
});

/** Every table that holds rows for one case. Payment-origin records are keyed by the Nessie transaction, not the case, and are kept. */
const CASE_TABLES = ["statements", "transactions", "providerEvidence", "activity", "processedEvents", "reimbursementDecisions", "caseProposals", "intakeTurns", "voiceSessions"] as const;
/** Rows deleted per table per mutation; a bigger case continues in a scheduled follow-up. */
const PURGE_BATCH = 500;

async function purgeBatch(ctx: MutationCtx, caseId: Id<"cases">): Promise<{ deleted: number; more: boolean }> {
  let deleted = 0;
  let more = false;
  for (const table of CASE_TABLES) {
    const rows = await ctx.db.query(table).withIndex("by_case", (q) => q.eq("caseId", caseId)).take(PURGE_BATCH);
    for (const r of rows) await ctx.db.delete(r._id);
    deleted += rows.length;
    if (rows.length === PURGE_BATCH) more = true;
  }
  return { deleted, more };
}

/**
 * Removes a synthetic case and everything recorded for it (developer tool; all data is synthetic).
 * The case row goes first, so it leaves every list at once and work still in flight for it (an
 * interpretation, persona setup, a CRS check) fails instead of writing new rows. Nessie records,
 * including SIMULATED payout deposits, are outside this app and stay.
 */
export const remove = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return { removed: false };
    await ctx.db.delete(caseId);
    const { deleted, more } = await purgeBatch(ctx, caseId);
    if (more) await ctx.scheduler.runAfter(0, internal.cases.purgeRemainingRows, { caseId });
    console.log(`case ${caseId} ("${c.title}") removed: ${deleted} row(s) deleted${more ? ", more scheduled" : ""}`);
    return { removed: true };
  },
});

export const purgeRemainingRows = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const { more } = await purgeBatch(ctx, caseId);
    if (more) await ctx.scheduler.runAfter(0, internal.cases.purgeRemainingRows, { caseId });
  },
});

export const view = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const [statements, evidence, activity, decisions] = await Promise.all([
      ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect(),
      currentEvidence(ctx, caseId),
      ctx.db.query("activity").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").take(200),
      ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect(),
    ]);
    // SYNTHETIC payment-origin records for this case's transactions (keyed by the Nessie id).
    const paymentOrigins = (
      await Promise.all(evidence.transactions.map((t) => ctx.db.query("paymentOrigins").withIndex("by_txn", (q) => q.eq("txnExternalId", t.externalId)).unique()))
    ).flatMap((o, i) => (o ? [{ txnRef: evidence.transactions[i]!.ref, ...o }] : []));
    return {
      case: { ...c, nessieAccountBound: c.nessieAccountId !== null },
      paymentOrigins,
      statements: statements.sort((a, b) => a.receivedAt - b.receivedAt),
      transactions: evidence.transactions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      providerEvidence: evidence.providerEvidence,
      /** Superseded evidence, kept for provenance. */
      history: evidence.history,
      /** Automatic approvals (policy AUTO-1) with their SIMULATED payout status. */
      decisions,
      activity,
    };
  },
});

/** Creates a synthetic case. The Nessie account is bound here by the backend (env), never by the client. */
export const createSynthetic = mutation({
  args: {},
  handler: async (ctx) => {
    const accountId = process.env.NESSIE_DEMO_ACCOUNT_ID ?? null;
    const now = Date.now();
    const caseId = await ctx.db.insert("cases", {
      title: `Synthetic claim ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}Z`,
      synthetic: true,
      customerLabel: DEMO_CUSTOMER_LABEL,
      nessieAccountId: accountId,
      nextStatementNumber: 1,
      bankFetch: { status: "never" },
      analysis: null,
      analysisVersion: 0,
      createdAt: now,
    });
    await logActivity(ctx, caseId, "system", "case_created", `Synthetic case created. Nessie demo account ${accountId ? "bound by backend configuration" : "not yet configured (set NESSIE_DEMO_ACCOUNT_ID; it binds on first retrieval)"}.`);
    await recomputeAnalysis(ctx, caseId);
    return caseId;
  },
});

/** Text channel. clientEventId makes retries/double-submits idempotent. */
export const submitStatement = mutation({
  args: {
    caseId: v.id("cases"),
    text: v.string(),
    clientEventId: v.string(),
    correctsRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(args.clientEventId)) throw new Error("invalid clientEventId");
    const { duplicate, ref } = await recordStatement(ctx, {
      caseId: args.caseId,
      text: args.text,
      channel: "text",
      idempotencyKey: `text:${args.caseId}:${args.clientEventId}`,
      ...(args.correctsRef ? { correctsRef: args.correctsRef } : {}),
    });
    return { duplicate, ref };
  },
});

// ---------- internal functions used by actions ----------

type TransactionFields = Omit<Doc<"transactions">, "_id" | "_creationTime" | "caseId" | "retrievedAt" | "supersededAt">;

function sameTransaction(row: Doc<"transactions">, t: TransactionFields): boolean {
  return (Object.keys(t) as (keyof TransactionFields)[]).every((k) => row[k] === t[k]);
}

export const getForAction = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    return c ? { _id: c._id, nessieAccountId: c.nessieAccountId } : null;
  },
});

/** Binds the backend-configured demo account to a case that has none. Never overwrites an existing binding. */
export const bindConfiguredAccount = internalMutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    const accountId = process.env.NESSIE_DEMO_ACCOUNT_ID;
    if (!c || c.nessieAccountId || !accountId) return c?.nessieAccountId ?? null;
    await ctx.db.patch(caseId, { nessieAccountId: accountId });
    await logActivity(ctx, caseId, "system", "account_bound", "Nessie demo account bound from backend configuration.");
    return accountId;
  },
});

export const storeTransactions = internalMutation({
  args: { caseId: v.id("cases"), transactions: v.array(v.object(transactionFields)), warnings: v.array(v.string()) },
  handler: async (ctx, { caseId, transactions, warnings }) => {
    const now = Date.now();
    let added = 0;
    let changed = 0;
    for (const t of transactions) {
      const rows = await ctx.db.query("transactions").withIndex("by_case_ref", (q) => q.eq("caseId", caseId).eq("ref", t.ref)).collect();
      const current = rows.find((r) => r.supersededAt === undefined);
      if (current && sameTransaction(current, t)) {
        await ctx.db.patch(current._id, { retrievedAt: now });
        continue;
      }
      // A changed record (e.g. status pending → posted → reversed) keeps its earlier version as history.
      if (current) {
        await ctx.db.patch(current._id, { supersededAt: now });
        changed++;
      } else added++;
      await ctx.db.insert("transactions", { caseId, retrievedAt: now, ...t });
    }
    await ctx.db.patch(caseId, { bankFetch: { status: "ok", at: now, count: transactions.length } });
    await logActivity(ctx, caseId, "nessie:live", "bank_records_retrieved", `LIVE Nessie retrieval: ${transactions.filter((t) => t.kind !== "deposit").length} purchase(s) and ${transactions.filter((t) => t.kind === "deposit").length} deposit(s), ${added} new, ${changed} changed (earlier versions kept).`);
    for (const w of warnings) await logActivity(ctx, caseId, "nessie:live", "warning", w);
    await applyPersonaOrigins(ctx, caseId);
    await recomputeAnalysis(ctx, caseId);
  },
});

export const recordBankFetchError = internalMutation({
  args: { caseId: v.id("cases"), error: v.string() },
  handler: async (ctx, { caseId, error }) => {
    const now = Date.now();
    await ctx.db.patch(caseId, { bankFetch: { status: "error", at: now, error: error.slice(0, 300) } });
    await logActivity(ctx, caseId, "nessie:live", "integration_error", `Nessie retrieval FAILED: ${error}. No fixture data was substituted.`);
    await recomputeAnalysis(ctx, caseId);
  },
});
