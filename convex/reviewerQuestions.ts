/**
 * Questions a bank reviewer puts to the customer. They are asked first on the customer's next
 * call or text chat (convex/voice.ts issueVoiceQuestion), and count as answered once a customer
 * reply to them is recorded. Withdrawn questions are kept for the record.
 */
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { logActivity, recomputeAnalysis } from "./model";

const MAX_QUESTION_CHARS = 300;

/** Unanswered, not withdrawn, oldest first. */
export async function openReviewerQuestions(ctx: QueryCtx, caseId: Id<"cases">) {
  const rows = await ctx.db.query("reviewerQuestions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  return rows.filter((r) => !r.answeredByRef && !r.withdrawnAt).sort((a, b) => a.askedAt - b.askedAt);
}

export const forCase = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) =>
    (await ctx.db.query("reviewerQuestions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()).sort((a, b) => b.askedAt - a.askedAt),
});

export const ask = mutation({
  args: { caseId: v.id("cases"), text: v.string() },
  handler: async (ctx, { caseId, text }) => {
    const t = text.trim().replace(/\s+/g, " ");
    if (!t) throw new Error("the question is empty");
    if (t.length > MAX_QUESTION_CHARS) throw new Error(`keep the question under ${MAX_QUESTION_CHARS} characters`);
    if (!(await ctx.db.get(caseId))) throw new Error("case not found");
    const id = await ctx.db.insert("reviewerQuestions", { caseId, text: t, askedAt: Date.now() });
    await logActivity(ctx, caseId, "human", "reviewer_question", `A reviewer asked the customer: "${t}". It is asked first on the customer's next call or text chat.`);
    // The reasoning model sees open reviewer questions, so the case state has changed.
    await recomputeAnalysis(ctx, caseId);
    return id;
  },
});

export const withdraw = mutation({
  args: { questionId: v.id("reviewerQuestions") },
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get(questionId);
    if (!q) throw new Error("question not found");
    if (q.answeredByRef) throw new Error("this question was already answered");
    if (q.withdrawnAt) return;
    await ctx.db.patch(questionId, { withdrawnAt: Date.now() });
    await logActivity(ctx, q.caseId, "human", "reviewer_question_withdrawn", `A reviewer withdrew the question: "${q.text}".`);
    await recomputeAnalysis(ctx, q.caseId);
  },
});
