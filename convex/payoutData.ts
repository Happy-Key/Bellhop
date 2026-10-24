/**
 * Persistence for SIMULATED reimbursement payouts. The Nessie call lives in convex/payout.ts.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { logActivity } from "./model";

export const getDecision = internalQuery({
  args: { decisionId: v.id("reimbursementDecisions") },
  handler: async (ctx, { decisionId }) => {
    const d = await ctx.db.get(decisionId);
    if (!d) return null;
    const c = await ctx.db.get(d.caseId);
    return { _id: d._id, caseId: d.caseId, txnRef: d.txnRef, amount: d.amount, policy: d.policy, outcome: d.outcome, payoutStatus: d.payout.status, accountId: c?.nessieAccountId ?? null };
  },
});

export const recordPayout = internalMutation({
  args: {
    decisionId: v.id("reimbursementDecisions"),
    result: v.union(v.object({ ok: v.literal(true), depositId: v.string(), reused: v.boolean() }), v.object({ ok: v.literal(false), error: v.string() })),
  },
  handler: async (ctx, { decisionId, result }) => {
    const d = await ctx.db.get(decisionId);
    if (!d || d.payout.status !== "pending") return;
    const at = Date.now();
    if (result.ok) {
      await ctx.db.patch(decisionId, { payout: { simulated: true, status: "deposited", depositId: result.depositId, reused: result.reused, at } });
      await logActivity(ctx, d.caseId, "nessie:live", "simulated_payout", `SIMULATED reimbursement of $${d.amount.toFixed(2)} deposited to the demo account (Nessie deposit ${result.depositId}${result.reused ? ", found from an earlier attempt" : ""}).`);
    } else {
      await ctx.db.patch(decisionId, { payout: { simulated: true, status: "failed", error: result.error.slice(0, 300), at } });
      await logActivity(ctx, d.caseId, "nessie:live", "integration_error", `SIMULATED payout FAILED: ${result.error}. The approval stands; retry the payout from the case page.`);
    }
  },
});

/** Explicit human retry of a failed payout. The payout checks for an earlier deposit first, so it can't pay twice. */
export const retryPayout = mutation({
  args: { decisionId: v.id("reimbursementDecisions") },
  handler: async (ctx, { decisionId }) => {
    const d = await ctx.db.get(decisionId);
    if (!d) throw new Error("decision not found");
    if (d.payout.status !== "failed") throw new Error(`payout is ${d.payout.status}, not failed`);
    await ctx.db.patch(decisionId, { payout: { simulated: true, status: "pending" } });
    await logActivity(ctx, d.caseId, "human", "payout_retry", `Retry of the SIMULATED payout for ${d.txnRef} requested.`);
    await ctx.scheduler.runAfter(0, internal.payout.payDecision, { decisionId });
  },
});

/**
 * A person reviews an automatic approval that was flagged after the facts changed. Affirming clears
 * the flag: the approval and its SIMULATED payout stand. Otherwise the flag stays, with the note.
 * Nothing is reversed here: money that moved is never reversed automatically, and this prototype has
 * no reversal path; a reversal would be a separate, explicit action.
 */
export const reviewFlaggedApproval = mutation({
  args: { decisionId: v.id("reimbursementDecisions"), affirm: v.boolean(), note: v.string() },
  handler: async (ctx, { decisionId, affirm, note }) => {
    const d = await ctx.db.get(decisionId);
    if (!d) throw new Error("decision not found");
    if (!d.needsReview) throw new Error("this approval is not flagged");
    if (d.needsReview.review?.affirmed) throw new Error("this approval was already affirmed");
    const trimmed = note.trim().slice(0, 1000);
    if (!affirm && !trimmed) throw new Error("keeping the flag needs a note");
    const at = Date.now();
    await ctx.db.patch(decisionId, { needsReview: { ...d.needsReview, review: { at, affirmed: affirm, note: trimmed } } });
    await logActivity(
      ctx,
      d.caseId,
      "human",
      affirm ? "approval_affirmed" : "approval_review_note",
      affirm
        ? `A person reviewed the flagged approval of ${d.txnRef} and AFFIRMED it.${trimmed ? ` Note: ${trimmed}` : ""}`
        : `A person reviewed the flagged approval of ${d.txnRef} and kept it flagged: ${trimmed}`,
    );
  },
});
