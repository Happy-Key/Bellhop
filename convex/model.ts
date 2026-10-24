/**
 * Shared backend helpers used by mutations (text input, voice tool calls, actions).
 * Text and voice go through the SAME recordStatement path into one case state.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { analyzeCase, type EvidenceFetchState } from "../lib/domain/workflow";
import { interpretStatementScripted, looksLikeCorrection } from "../lib/domain/interpret";
import type { Statement, TransactionEvidence, ProviderEvidence } from "../lib/domain/schemas";

export const MAX_STATEMENT_CHARS = 4000;

export type ReasoningConfig = { mode: "scripted" } | { mode: "live"; label: string };

/** Which reasoning provider is configured. Read from Convex environment variables. */
export function reasoningConfig(): ReasoningConfig {
  const p = process.env.REASONING_PROVIDER ?? "scripted";
  if (p === "openai-compatible") return { mode: "live", label: process.env.REASONING_PROVIDER_LABEL ?? "openai-compatible" };
  return { mode: "scripted" };
}

export async function logActivity(ctx: MutationCtx, caseId: Id<"cases">, actor: string, kind: string, message: string) {
  await ctx.db.insert("activity", { caseId, at: Date.now(), actor, kind, message: message.slice(0, 1000) });
}

export async function loadCaseInput(ctx: QueryCtx, caseId: Id<"cases">) {
  const c = await ctx.db.get(caseId);
  if (!c) throw new Error("case not found");
  const statements = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const transactions = await ctx.db.query("transactions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const providerEvidence = await ctx.db.query("providerEvidence").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  return { c, statements, transactions, providerEvidence };
}

export function toDomainStatement(s: Doc<"statements">): Statement {
  return {
    ref: s.ref,
    text: s.text,
    channel: s.channel,
    receivedAt: s.receivedAt,
    ...(s.correctsRef ? { correctsRef: s.correctsRef } : {}),
    interpretation: s.interpretation,
  };
}

export function toDomainTransaction(t: Doc<"transactions">): TransactionEvidence {
  return {
    ref: t.ref, provider: t.provider, externalId: t.externalId, kind: t.kind, amount: t.amount, date: t.date,
    description: t.description, merchantId: t.merchantId, merchantName: t.merchantName, status: t.status, medium: t.medium,
  };
}

/** Recompute the derived analysis from stored evidence. Called after every evidence change. */
export async function recomputeAnalysis(ctx: MutationCtx, caseId: Id<"cases">) {
  const { c, statements, transactions, providerEvidence } = await loadCaseInput(ctx, caseId);
  const analysis = analyzeCase({
    statements: statements.map(toDomainStatement),
    transactions: transactions.map(toDomainTransaction),
    providerEvidence: providerEvidence.map(
      (p): ProviderEvidence => ({ ref: p.ref, provider: p.provider, product: p.product, field: p.field, value: p.value, syntheticAssociation: p.syntheticAssociation }),
    ),
    bankFetch: c.bankFetch as EvidenceFetchState,
    proposedFindings: statements.flatMap((s) => s.proposedFindings ?? []),
  });
  // Rejected model output is stored as a string so arbitrary keys can't break document storage.
  const stored = {
    ...analysis,
    rejectedFindings: analysis.rejectedFindings.map((r) => ({ finding: JSON.stringify(r.finding).slice(0, 600), reasons: r.reasons })),
  };
  await ctx.db.patch(caseId, { analysis: JSON.parse(JSON.stringify(stored)), analysisVersion: c.analysisVersion + 1 });
  if (analysis.rejectedFindings.length > 0) {
    await logActivity(ctx, caseId, "validator", "findings_rejected", `${analysis.rejectedFindings.length} proposed finding(s) rejected: ${analysis.rejectedFindings.map((r) => r.reasons.join("; ")).join(" | ")}`);
  }
}

export interface RecordStatementArgs {
  caseId: Id<"cases">;
  text: string;
  channel: "text" | "voice";
  idempotencyKey: string;
  correctsRef?: string;
}

export type RecordStatementResult = { duplicate: boolean; ref: string };

export async function recordStatement(ctx: MutationCtx, args: RecordStatementArgs): Promise<RecordStatementResult> {
  const prior = await ctx.db.query("processedEvents").withIndex("by_key", (q) => q.eq("key", args.idempotencyKey)).unique();
  if (prior) {
    if (prior.caseId !== args.caseId) throw new Error("idempotency key belongs to a different case");
    return { duplicate: true, ref: prior.resultRef ?? "" };
  }
  const c = await ctx.db.get(args.caseId);
  if (!c) throw new Error("case not found");
  const text = args.text.trim();
  if (!text) throw new Error("statement is empty");
  if (text.length > MAX_STATEMENT_CHARS) throw new Error(`statement exceeds ${MAX_STATEMENT_CHARS} characters`);

  let correctsRef = args.correctsRef;
  let autoLinked = false;
  if (correctsRef) {
    const target = await ctx.db.query("statements").withIndex("by_case_ref", (q) => q.eq("caseId", args.caseId).eq("ref", correctsRef!)).unique();
    if (!target) throw new Error(`statement ${correctsRef} does not exist in this case`);
  } else if (looksLikeCorrection(text) && c.nextStatementNumber > 1) {
    correctsRef = `S${c.nextStatementNumber - 1}`;
    autoLinked = true;
  }

  const ref = `S${c.nextStatementNumber}`;
  const receivedAt = Date.now();
  const cfg = reasoningConfig();
  const statementId = await ctx.db.insert("statements", {
    caseId: args.caseId,
    ref,
    text,
    channel: args.channel,
    receivedAt,
    ...(correctsRef ? { correctsRef } : {}),
    interpretation: cfg.mode === "scripted" ? interpretStatementScripted(text, receivedAt) : null,
    interpretationStatus: cfg.mode === "scripted" ? "done" : "pending",
  });
  await ctx.db.patch(args.caseId, { nextStatementNumber: c.nextStatementNumber + 1 });
  await ctx.db.insert("processedEvents", { key: args.idempotencyKey, caseId: args.caseId, at: receivedAt, resultRef: ref });

  await logActivity(ctx, args.caseId, `customer:${args.channel}`, "statement_recorded", `${ref} recorded${correctsRef ? ` as correction of ${correctsRef}${autoLinked ? " (auto-linked by scripted heuristic)" : ""}` : ""}.`);
  if (cfg.mode === "scripted") {
    await logActivity(ctx, args.caseId, "reasoning:scripted", "interpreted", `${ref} interpreted by SCRIPTED pattern extractor (not a model).`);
  } else {
    await logActivity(ctx, args.caseId, `reasoning:${cfg.label}`, "interpretation_requested", `${ref} sent for live model interpretation.`);
    await ctx.scheduler.runAfter(0, internal.reasoning.interpretLive, { statementId });
  }
  await recomputeAnalysis(ctx, args.caseId);
  return { duplicate: false, ref };
}
