/**
 * SYNTHETIC payment-origin records (how a payment was made). A real bank reads these from its own
 * authentication logs; here a reviewer attaches a preset to a transaction for the demo.
 */
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { currentEvidence, logActivity, recomputeAnalysis } from "./model";
import { PAYMENT_ORIGIN_PRESETS, type PaymentOriginPreset } from "../lib/fixtures/paymentOrigins";

export const setSynthetic = mutation({
  args: { caseId: v.id("cases"), txnRef: v.string(), preset: v.string() },
  handler: async (ctx, { caseId, txnRef, preset }) => {
    if (!(preset in PAYMENT_ORIGIN_PRESETS)) throw new Error(`unknown preset ${preset}`);
    const { transactions } = await currentEvidence(ctx, caseId);
    // Only transactions already retrieved for this case: the client can't name arbitrary records.
    const txn = transactions.find((t) => t.ref === txnRef);
    if (!txn) throw new Error(`transaction ${txnRef} is not on this case`);
    const p = PAYMENT_ORIGIN_PRESETS[preset as PaymentOriginPreset];
    const existing = await ctx.db.query("paymentOrigins").withIndex("by_txn", (q) => q.eq("txnExternalId", txn.externalId)).unique();
    const row = { txnExternalId: txn.externalId, ...p.origin, synthetic: true as const, preset, setAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("paymentOrigins", row);
    await logActivity(ctx, caseId, "human", "payment_origin_set", `SYNTHETIC payment-origin record attached to ${txnRef}: ${p.label}.`);
    await recomputeAnalysis(ctx, caseId);
  },
});
