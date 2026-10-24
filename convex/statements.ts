import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { currentEvidence, logActivity, recomputeAnalysis, reasoningConfig } from "./model";
import { interpretation } from "./validators";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { REGULATORY_REFS } from "../lib/domain/regulatory";

export const contextForReasoning = internalQuery({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => {
    const s = await ctx.db.get(statementId);
    if (!s) return null;
    const all = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", s.caseId)).collect();
    const { transactions: txns } = await currentEvidence(ctx, s.caseId);
    return {
      statement: { ref: s.ref, text: s.text, receivedAt: s.receivedAt },
      priorStatements: all.filter((x) => x.receivedAt < s.receivedAt).map((x) => ({ ref: x.ref, text: x.text })),
      citableRefs: [...all.map((x) => x.ref), ...txns.map((t) => t.ref), ...REGULATORY_REFS],
    };
  },
});

/**
 * Only the statement's current attempt may write its result. A result from an attempt that a
 * retry, or an explicit scripted interpretation, has since replaced is discarded and logged.
 */
async function isCurrentAttempt(ctx: MutationCtx, s: Doc<"statements">, attemptId: string, outcome: string): Promise<boolean> {
  if (s.currentAttemptId === attemptId) return true;
  await logActivity(ctx, s.caseId, "reasoning:live", "stale_result_discarded", `${outcome} for ${s.ref} came from a superseded attempt and was discarded.`);
  return false;
}

export const applyInterpretation = internalMutation({
  args: {
    statementId: v.id("statements"),
    attemptId: v.string(),
    interpretation,
    proposedFindings: v.array(v.any()),
    followUpQuestion: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.statementId);
    if (!s) return;
    if (!(await isCurrentAttempt(ctx, s, args.attemptId, "A live interpretation"))) return;
    await ctx.db.patch(args.statementId, {
      interpretation: args.interpretation,
      interpretationStatus: "done",
      // Stored as JSON-safe values; validated against evidence during analysis.
      proposedFindings: JSON.parse(JSON.stringify(args.proposedFindings)),
      followUpQuestion: args.followUpQuestion,
    });
    await logActivity(ctx, s.caseId, `reasoning:${args.interpretation.provider}`, "interpreted", `${s.ref} interpreted by LIVE model ${args.interpretation.provider}.`);
    await recomputeAnalysis(ctx, s.caseId);
  },
});

export const markInterpretationFailed = internalMutation({
  args: { statementId: v.id("statements"), attemptId: v.string(), error: v.string() },
  handler: async (ctx, { statementId, attemptId, error }) => {
    const s = await ctx.db.get(statementId);
    if (!s) return;
    if (!(await isCurrentAttempt(ctx, s, attemptId, "A live interpretation failure"))) return;
    await ctx.db.patch(statementId, { interpretationStatus: "failed", interpretationError: error.slice(0, 300) });
    await logActivity(ctx, s.caseId, "reasoning:live", "integration_error", `Live interpretation of ${s.ref} FAILED: ${error}. Statement left uninterpreted (no scripted fallback).`);
    await recomputeAnalysis(ctx, s.caseId);
  },
});

/** Explicit, user-initiated retry of live interpretation. */
export const retryLive = mutation({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => {
    const s = await ctx.db.get(statementId);
    if (!s) throw new Error("statement not found");
    if (reasoningConfig().mode !== "live") throw new Error("live reasoning is not configured");
    // A new attempt replaces any attempt still in flight; that one's result will be discarded.
    const attemptId = crypto.randomUUID();
    await ctx.db.patch(statementId, { interpretationStatus: "pending", currentAttemptId: attemptId });
    await logActivity(ctx, s.caseId, "human", "interpretation_retry", `Live interpretation retry requested for ${s.ref}.`);
    await ctx.scheduler.runAfter(0, internal.reasoning.interpretLive, { statementId, attemptId });
  },
});

/** Explicit, user-initiated scripted interpretation of a statement whose live call failed. Labelled scripted. */
export const interpretScriptedExplicitly = mutation({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => {
    const s = await ctx.db.get(statementId);
    if (!s) throw new Error("statement not found");
    if (s.interpretationStatus === "done") return;
    // Clearing the attempt means a live result still in flight cannot overwrite this one.
    await ctx.db.patch(statementId, { interpretation: interpretStatementScripted(s.text, s.receivedAt), interpretationStatus: "done", currentAttemptId: undefined });
    await logActivity(ctx, s.caseId, "human", "interpreted", `${s.ref} interpreted by SCRIPTED extractor at reviewer's explicit request.`);
    await recomputeAnalysis(ctx, s.caseId);
  },
});
