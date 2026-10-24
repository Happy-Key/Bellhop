"use node";
/**
 * Whole-case decision proposal from the live reasoning model (Bitdeer). Validation and who acts
 * happen in convex/proposals.ts. On failure the proposal is marked failed and shown; the
 * rule-based route stands and nothing falls back silently.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { OpenAICompatibleReasoningProvider, reasoningEffortFromEnv } from "../lib/providers/reasoning";
import { redact } from "../lib/providers/errors";

export const proposeLive = internalAction({
  args: { proposalId: v.id("caseProposals") },
  handler: async (ctx, { proposalId }): Promise<void> => {
    const job: { input: unknown } | null = await ctx.runQuery(internal.proposals.getForAction, { proposalId });
    if (!job) return;
    const { REASONING_BASE_URL, REASONING_API_KEY, REASONING_MODEL } = process.env;
    const label = process.env.REASONING_PROVIDER_LABEL ?? "openai-compatible";
    if (!REASONING_BASE_URL || !REASONING_API_KEY || !REASONING_MODEL) {
      await ctx.runMutation(internal.proposals.applyResult, { proposalId, provider: label, result: { ok: false, error: "REASONING_BASE_URL / REASONING_API_KEY / REASONING_MODEL not all set" } });
      return;
    }
    const provider = new OpenAICompatibleReasoningProvider({
      baseUrl: REASONING_BASE_URL,
      apiKey: REASONING_API_KEY,
      model: REASONING_MODEL,
      providerLabel: label,
      reasoningEffort: reasoningEffortFromEnv(process.env.REASONING_EFFORT),
    });
    try {
      const raw = await provider.proposeCase(job.input as Parameters<typeof provider.proposeCase>[0]);
      await ctx.runMutation(internal.proposals.applyResult, { proposalId, provider: provider.id, result: { ok: true, raw } });
    } catch (e) {
      await ctx.runMutation(internal.proposals.applyResult, { proposalId, provider: provider.id, result: { ok: false, error: redact(e instanceof Error ? e.message : String(e)) } });
    }
  },
});
