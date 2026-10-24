/**
 * Shared backend helpers used by mutations (text input, voice tool calls, actions).
 * Text and voice go through the SAME recordStatement path into one case state.
 */
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { analyzeCase, type EvidenceFetchState } from "../lib/domain/workflow";
import { interpretStatementScripted, looksLikeCorrection } from "../lib/domain/interpret";
import { interpretAnswer, relatedRefFromKey } from "../lib/domain/answers";
import { redactSensitive } from "../lib/domain/redact";
import { evaluateAutoApproval, type AutoApprovalEvaluation } from "../lib/domain/autoApproval";
import type { AskedQuestion, Statement, StatementInterpretation, TransactionEvidence, ProviderEvidence } from "../lib/domain/schemas";

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

/** Current (not superseded) transactions and provider facts for a case. Superseded rows are history. */
export async function currentEvidence(ctx: QueryCtx, caseId: Id<"cases">) {
  const transactions = await ctx.db.query("transactions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const providerEvidence = await ctx.db.query("providerEvidence").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  return {
    transactions: transactions.filter((t) => t.supersededAt === undefined),
    providerEvidence: providerEvidence.filter((p) => p.supersededAt === undefined),
    history: {
      transactions: transactions.filter((t) => t.supersededAt !== undefined),
      providerEvidence: providerEvidence.filter((p) => p.supersededAt !== undefined),
    },
  };
}

export async function loadCaseInput(ctx: QueryCtx, caseId: Id<"cases">) {
  const c = await ctx.db.get(caseId);
  if (!c) throw new Error("case not found");
  const statements = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const { transactions, providerEvidence } = await currentEvidence(ctx, caseId);
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
    ...(s.inResponseTo ? { inResponseTo: s.inResponseTo } : {}),
    ...(s.answer ? { answer: s.answer } : {}),
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
    // Models number their findings F1, F2… for every statement, colliding with each other and with
    // rule-based findings (duplicate React keys seen live). Re-key them by statement: S2-M1, S2-M2…
    proposedFindings: statements.flatMap((s) =>
      (s.proposedFindings ?? []).map((f, i) => (f && typeof f === "object" && !Array.isArray(f) ? { ...(f as object), id: `${s.ref}-M${i + 1}` } : f)),
    ),
  });
  // Rejected model output is stored as a string so arbitrary keys can't break document storage.
  const stored = {
    ...analysis,
    rejectedFindings: analysis.rejectedFindings.map((r) => ({ finding: JSON.stringify(r.finding).slice(0, 600), reasons: r.reasons })),
  };
  const evaluation = evaluateAutoApproval({ analysis, transactions: transactions.map(toDomainTransaction), statements: statements.map(toDomainStatement) });
  await ctx.db.patch(caseId, { analysis: JSON.parse(JSON.stringify(stored)), analysisVersion: c.analysisVersion + 1, autoApproval: evaluation });
  if (analysis.rejectedFindings.length > 0) {
    await logActivity(ctx, caseId, "validator", "findings_rejected", `${analysis.rejectedFindings.length} proposed finding(s) rejected: ${analysis.rejectedFindings.map((r) => r.reasons.join("; ")).join(" | ")}`);
  }
  await applyAutoApproval(ctx, caseId, evaluation);
}

/**
 * Approve-only automation (policy AUTO-1). One automatic approval per case, made once: it records
 * the decision and schedules the SIMULATED payout. If later facts make the policy fail, the
 * approval is flagged for a person; nothing is ever denied or reversed automatically.
 */
async function applyAutoApproval(ctx: MutationCtx, caseId: Id<"cases">, evaluation: AutoApprovalEvaluation) {
  const decisions = await ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  if (evaluation.eligible && evaluation.txnRef && evaluation.amount !== null) {
    if (decisions.length > 0) return;
    const decisionId = await ctx.db.insert("reimbursementDecisions", {
      caseId,
      txnRef: evaluation.txnRef,
      amount: evaluation.amount,
      policy: evaluation.policy,
      outcome: "auto_approved",
      checks: evaluation.checks,
      decidedAt: Date.now(),
      payout: { simulated: true, status: "pending" },
    });
    await logActivity(ctx, caseId, `policy:${evaluation.policy}`, "auto_approved", `AUTOMATICALLY APPROVED under ${evaluation.policy}: $${evaluation.amount.toFixed(2)} for ${evaluation.txnRef}; all ${evaluation.checks.length} checks passed. SIMULATED credit scheduled.`);
    await ctx.scheduler.runAfter(0, internal.payout.payDecision, { decisionId });
    return;
  }
  const failed = evaluation.checks.filter((c) => !c.passed);
  for (const d of decisions) {
    if (d.needsReview) continue;
    const reason = `Facts changed after automatic approval; now failing: ${failed.map((c) => c.id).join(", ")}.`;
    await ctx.db.patch(d._id, { needsReview: { at: Date.now(), reason } });
    await logActivity(ctx, caseId, `policy:${evaluation.policy}`, "auto_approval_needs_review", `${reason} A person must review the approval of ${d.txnRef}; nothing was reversed.`);
  }
}

export interface RecordStatementArgs {
  caseId: Id<"cases">;
  text: string;
  channel: "text" | "voice";
  idempotencyKey: string;
  correctsRef?: string;
  /** The question this statement replies to, when the backend knows it. */
  inResponseTo?: AskedQuestion;
}

export type RecordStatementResult = { duplicate: boolean; ref: string; statementId: Id<"statements"> | null };

const SCRIPTED_FIELDS = ["amounts", "dates", "merchantTerms"] as const;

/** Which fields a scripted reading gives values for (used only to pick a correction target). */
function fieldsOf(i: StatementInterpretation | null): Set<string> {
  const out = new Set<string>();
  if (!i) return out;
  for (const f of SCRIPTED_FIELDS) if (i[f].length) out.add(f);
  if (i.authorization !== "unspecified") out.add("authorization");
  if (i.credentialSharing !== "unspecified") out.add("credentialSharing");
  return out;
}

/**
 * A statement that reads like a correction corrects the most recent earlier statement that gave a
 * value for one of the same fields; failing that, the most recent one that gave any value. A reply
 * like "Yes." in between is never the target. Returns null when nothing earlier qualifies.
 */
function correctionTarget(text: string, receivedAt: number, earlier: Doc<"statements">[]): string | null {
  const mine = fieldsOf(interpretStatementScripted(text, receivedAt));
  const newestFirst = [...earlier].sort((a, b) => b.receivedAt - a.receivedAt);
  const fieldsFor = (s: Doc<"statements">) => fieldsOf(s.interpretation ?? interpretStatementScripted(s.text, s.receivedAt));
  const sameField = newestFirst.find((s) => [...fieldsFor(s)].some((f) => mine.has(f)));
  if (sameField) return sameField.ref;
  return newestFirst.find((s) => fieldsFor(s).size > 0)?.ref ?? null;
}

export async function recordStatement(ctx: MutationCtx, args: RecordStatementArgs): Promise<RecordStatementResult> {
  const prior = await ctx.db.query("processedEvents").withIndex("by_key", (q) => q.eq("key", args.idempotencyKey)).unique();
  if (prior) {
    if (prior.caseId !== args.caseId) throw new Error("idempotency key belongs to a different case");
    return { duplicate: true, ref: prior.resultRef ?? "", statementId: null };
  }
  const c = await ctx.db.get(args.caseId);
  if (!c) throw new Error("case not found");
  // Card numbers, codes, passwords and SSNs are removed before anything is stored or logged.
  const redacted = redactSensitive(args.text.trim());
  const text = redacted.text;
  if (!text) throw new Error("statement is empty");
  if (text.length > MAX_STATEMENT_CHARS) throw new Error(`statement exceeds ${MAX_STATEMENT_CHARS} characters`);
  const receivedAt = Date.now();

  let correctsRef = args.correctsRef;
  let autoLinked = false;
  if (correctsRef) {
    const target = await ctx.db.query("statements").withIndex("by_case_ref", (q) => q.eq("caseId", args.caseId).eq("ref", correctsRef!)).unique();
    if (!target) throw new Error(`statement ${correctsRef} does not exist in this case`);
  } else if (looksLikeCorrection(text) && c.nextStatementNumber > 1) {
    const earlier = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", args.caseId)).collect();
    const target = correctionTarget(text, receivedAt, earlier);
    if (target) {
      correctsRef = target;
      autoLinked = true;
    }
  }

  const ref = `S${c.nextStatementNumber}`;
  const cfg = reasoningConfig();
  const answer = interpretAnswer(text, args.inResponseTo, args.inResponseTo ? relatedRefFromKey(args.inResponseTo.key) : undefined);
  const attemptId = cfg.mode === "live" ? crypto.randomUUID() : undefined;
  const statementId = await ctx.db.insert("statements", {
    caseId: args.caseId,
    ref,
    text,
    channel: args.channel,
    receivedAt,
    ...(correctsRef ? { correctsRef } : {}),
    ...(args.inResponseTo ? { inResponseTo: args.inResponseTo } : {}),
    ...(answer ? { answer } : {}),
    ...(redacted.kinds.length ? { redactions: redacted.kinds } : {}),
    interpretation: cfg.mode === "scripted" ? interpretStatementScripted(text, receivedAt) : null,
    interpretationStatus: cfg.mode === "scripted" ? "done" : "pending",
    ...(attemptId ? { currentAttemptId: attemptId } : {}),
  });
  await ctx.db.patch(args.caseId, { nextStatementNumber: c.nextStatementNumber + 1 });
  await ctx.db.insert("processedEvents", { key: args.idempotencyKey, caseId: args.caseId, at: receivedAt, resultRef: ref });

  await logActivity(ctx, args.caseId, `customer:${args.channel}`, "statement_recorded", `${ref} recorded${correctsRef ? ` as correction of ${correctsRef}${autoLinked ? " (auto-linked by scripted heuristic)" : ""}` : ""}${args.inResponseTo ? ` in reply to "${args.inResponseTo.key}"` : ""}.`);
  if (redacted.kinds.length) {
    await logActivity(ctx, args.caseId, "system", "sensitive_removed", `${ref}: sensitive value(s) removed before storage (${redacted.kinds.join(", ")}). Only the kind is kept.`);
  }
  if (answer && answer.state !== "unparsed") {
    await logActivity(ctx, args.caseId, "rules:answer-parser", "answer_read", `${ref} read as ${answer.state} for "${answer.key}" (RULE-BASED, using the question as context).`);
  }
  if (cfg.mode === "scripted") {
    await logActivity(ctx, args.caseId, "reasoning:scripted", "interpreted", `${ref} interpreted by SCRIPTED pattern extractor (not a model).`);
  } else {
    await logActivity(ctx, args.caseId, `reasoning:${cfg.label}`, "interpretation_requested", `${ref} sent for live model interpretation.`);
    await ctx.scheduler.runAfter(0, internal.reasoning.interpretLive, { statementId, attemptId: attemptId! });
  }
  await recomputeAnalysis(ctx, args.caseId);
  return { duplicate: false, ref, statementId };
}
