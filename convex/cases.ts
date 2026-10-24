import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { logActivity, recomputeAnalysis, recordStatement } from "./model";
import { transactionFields } from "./validators";
import { DEMO_CUSTOMER_LABEL } from "../lib/fixtures/demo";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query("cases").order("desc").take(50);
    return cases.map((c) => ({ _id: c._id, title: c.title, createdAt: c.createdAt, stage: (c.analysis as { stage?: string } | null)?.stage ?? "intake" }));
  },
});

export const view = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    const [statements, transactions, providerEvidence, activity] = await Promise.all([
      ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect(),
      ctx.db.query("transactions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect(),
      ctx.db.query("providerEvidence").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect(),
      ctx.db.query("activity").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").take(200),
    ]);
    return {
      case: { ...c, nessieAccountBound: c.nessieAccountId !== null },
      statements: statements.sort((a, b) => a.receivedAt - b.receivedAt),
      transactions: transactions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
      providerEvidence,
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
    return recordStatement(ctx, {
      caseId: args.caseId,
      text: args.text,
      channel: "text",
      idempotencyKey: `text:${args.caseId}:${args.clientEventId}`,
      ...(args.correctsRef ? { correctsRef: args.correctsRef } : {}),
    });
  },
});

// ---------- internal functions used by actions ----------

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
    for (const t of transactions) {
      const existing = await ctx.db.query("transactions").withIndex("by_case_ref", (q) => q.eq("caseId", caseId).eq("ref", t.ref)).unique();
      if (existing) await ctx.db.patch(existing._id, { ...t, retrievedAt: now });
      else {
        await ctx.db.insert("transactions", { caseId, retrievedAt: now, ...t });
        added++;
      }
    }
    await ctx.db.patch(caseId, { bankFetch: { status: "ok", at: now, count: transactions.length } });
    await logActivity(ctx, caseId, "nessie:live", "bank_records_retrieved", `LIVE Nessie retrieval: ${transactions.length} purchase record(s), ${added} new.`);
    for (const w of warnings) await logActivity(ctx, caseId, "nessie:live", "warning", w);
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
