"use node";
/**
 * SIMULATED reimbursement payout: a Nessie deposit on the backend-bound demo account, for an
 * automatically approved claim (policy AUTO-1). Synthetic money only.
 * - The account comes from the case (bound by the backend), never from client or model input.
 * - At most once per decision: `depositOnce` looks for an earlier deposit carrying the decision's
 *   marker before writing, and the decision must still be `pending`.
 * - Failures are recorded and shown; there is no automatic retry.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { NessieClient, depositOnce } from "../lib/providers/nessie";
import { redact } from "../lib/providers/errors";

export const payDecision = internalAction({
  args: { decisionId: v.id("reimbursementDecisions") },
  // Explicit types break the circular inference between this action and the generated `internal` API.
  handler: async (ctx, { decisionId }): Promise<void> => {
    const d: { amount: number; txnRef: string; policy: string; payoutStatus: string; accountId: string | null } | null = await ctx.runQuery(internal.payoutData.getDecision, { decisionId });
    if (!d || d.payoutStatus !== "pending") return;
    const fail = async (error: string): Promise<void> => {
      await ctx.runMutation(internal.payoutData.recordPayout, { decisionId, result: { ok: false, error } });
    };
    if (!d.accountId) return fail("no Nessie demo account is bound to this case");
    const apiKey = process.env.NESSIE_API_KEY;
    if (!apiKey) return fail("NESSIE_API_KEY is not set in the Convex deployment environment");
    if (!Number.isInteger(d.amount)) return fail(`Nessie deposits take whole dollars; $${d.amount.toFixed(2)} must be paid by a person`);
    const marker = `[claim ${decisionId}]`;
    try {
      const r = await depositOnce(new NessieClient(apiKey, process.env.NESSIE_BASE_URL || undefined), d.accountId, {
        amount: d.amount,
        date: new Date().toISOString().slice(0, 10),
        description: `SIMULATED reimbursement for ${d.txnRef}, auto-approved under ${d.policy} ${marker}`,
        marker,
      });
      await ctx.runMutation(internal.payoutData.recordPayout, { decisionId, result: { ok: true, ...r } });
    } catch (e) {
      await fail(redact(e instanceof Error ? e.message : String(e)));
    }
  },
});
