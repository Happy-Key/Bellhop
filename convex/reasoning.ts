"use node";
/**
 * Live model interpretation (only when REASONING_PROVIDER=openai-compatible).
 * On failure the statement is marked failed and shown as such; there is no silent
 * fallback to scripted interpretation.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { OpenAICompatibleReasoningProvider, reasoningEffortFromEnv } from "../lib/providers/reasoning";
import { redact } from "../lib/providers/errors";

export const interpretLive = internalAction({
  // attemptId ties the result to the attempt that requested it; stale results are discarded on apply.
  args: { statementId: v.id("statements"), attemptId: v.string() },
  handler: async (ctx, { statementId, attemptId }) => {
    const input = await ctx.runQuery(internal.statements.contextForReasoning, { statementId });
    if (!input) return;
    const { REASONING_BASE_URL, REASONING_API_KEY, REASONING_MODEL } = process.env;
    if (!REASONING_BASE_URL || !REASONING_API_KEY || !REASONING_MODEL) {
      await ctx.runMutation(internal.statements.markInterpretationFailed, {
        statementId,
        attemptId,
        error: "live reasoning selected but REASONING_BASE_URL / REASONING_API_KEY / REASONING_MODEL not all set",
      });
      return;
    }
    const provider = new OpenAICompatibleReasoningProvider({
      baseUrl: REASONING_BASE_URL,
      apiKey: REASONING_API_KEY,
      model: REASONING_MODEL,
      providerLabel: process.env.REASONING_PROVIDER_LABEL ?? "openai-compatible",
      reasoningEffort: reasoningEffortFromEnv(process.env.REASONING_EFFORT),
    });
    try {
      const result = await provider.interpret(input);
      await ctx.runMutation(internal.statements.applyInterpretation, {
        statementId,
        attemptId,
        interpretation: result.interpretation,
        proposedFindings: result.proposedFindings,
        followUpQuestion: result.followUpQuestion,
      });
    } catch (e) {
      await ctx.runMutation(internal.statements.markInterpretationFailed, { statementId, attemptId, error: redact(e instanceof Error ? e.message : String(e)) });
    }
  },
});
