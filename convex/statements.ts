import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { logActivity, recomputeAnalysis, reasoningConfig } from "./model";
import { interpretation } from "./validators";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { REGULATORY_REFS } from "../lib/domain/regulatory";

export const contextForReasoning = internalQuery({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => {
    const s = await ctx.db.get(statementId);
    if (!s) return null;
    const all = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", s.caseId)).collect();
    const txns = await ctx.db.query("transactions").withIndex("by_case", (q) => q.eq("caseId", s.caseId)).collect();
    return {
      statement: { ref: s.ref, text: s.text, receivedAt: s.receivedAt },
      priorStatements: all.filter((x) => x.receivedAt < s.receivedAt).map((x) => ({ ref: x.ref, text: x.text })),
      citableRefs: [...all.map((x) => x.ref), ...txns.map((t) => t.ref), ...REGULATORY_REFS],
    };
  },
});

export const applyInterpretation = internalMutation({
  args: {
    statementId: v.id("statements"),
    interpretation,
    proposedFindings: v.array(v.any()),
    followUpQuestion: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.statementId);
    if (!s) return;
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
  args: { statementId: v.id("statements"), error: v.string() },
  handler: async (ctx, { statementId, error }) => {
    const s = await ctx.db.get(statementId);
    if (!s) return;
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
    await ctx.db.patch(statementId, { interpretationStatus: "pending" });
    await logActivity(ctx, s.caseId, "human", "interpretation_retry", `Live interpretation retry requested for ${s.ref}.`);
    await ctx.scheduler.runAfter(0, internal.reasoning.interpretLive, { statementId });
  },
});

/** Explicit, user-initiated scripted interpretation of a statement whose live call failed. Labelled scripted. */
export const interpretScriptedExplicitly = mutation({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => {
    const s = await ctx.db.get(statementId);
    if (!s) throw new Error("statement not found");
    if (s.interpretationStatus === "done") return;
    await ctx.db.patch(statementId, { interpretation: interpretStatementScripted(s.text, s.receivedAt), interpretationStatus: "done" });
    await logActivity(ctx, s.caseId, "human", "interpreted", `${s.ref} interpreted by SCRIPTED extractor at reviewer's explicit request.`);
    await recomputeAnalysis(ctx, s.caseId);
  },
});
