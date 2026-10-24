/**
 * The reasoning model's assessment of each case (Bitdeer): its investigation (findings,
 * hypotheses, uncertainties, work items) and the proposed next step or disposition. The model
 * call is in convex/caseReasoning.ts; the rules for who acts are in lib/domain/caseDecision.ts.
 *
 * - The model reassesses the case automatically whenever its state changes (live reasoning on),
 *   at most once per case state, or when a reviewer asks. Every assessment is kept, with a
 *   code-computed diff against the one before, so revisions are recorded rather than replaced.
 * - Only the newest proposal for the CURRENT case state is acted on.
 * - Approvals pay out automatically only when policy AUTO-1 also passes; denials always need a
 *   person. No function here takes an account ID or an amount from the client.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { buildCaseReasoningInput, executionPlan, inputSignature, readyForAssessment, validateProposal, CaseProposalOutput, type CaseProposal, type CaseReasoningInput } from "../lib/domain/caseDecision";
import { diffInvestigations } from "../lib/domain/investigation";
import type { AutoApprovalEvaluation } from "../lib/domain/autoApproval";
import type { CaseAnalysis } from "../lib/domain/workflow";
import { readStoredAnalysis } from "../lib/domain/triage";
import { loadCaseInput, logActivity, reasoningConfig, toDomainProviderEvidence, toDomainStatement, toDomainTransaction } from "./model";

/** Case reasoning runs when live reasoning is configured, unless CASE_REASONING=off. */
export function caseReasoningEnabled(): boolean {
  return reasoningConfig().mode === "live" && process.env.CASE_REASONING !== "off";
}

/** The newest assessment that completed and passed validation. */
const lastAccepted = (ctx: QueryCtx, caseId: Id<"cases">) =>
  ctx.db.query("caseProposals").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").filter((q) => q.eq(q.field("status"), "done")).first();

async function currentInput(ctx: QueryCtx, caseId: Id<"cases">): Promise<{ input: CaseReasoningInput; analysis: CaseAnalysis; c: Doc<"cases"> } | null> {
  const { c, statements, transactions, providerEvidence } = await loadCaseInput(ctx, caseId);
  const analysis = readStoredAnalysis<CaseAnalysis>(c.analysis);
  if (!analysis) return null;
  const prev = (await lastAccepted(ctx, caseId))?.proposal as CaseProposal | undefined;
  const actions = await ctx.db.query("reviewActions").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  const input = buildCaseReasoningInput({
    previous: prev?.investigation ? { decision: prev.decision, investigation: prev.investigation } : null,
    // What the bank's reviewer asked for, oldest first. Part of the signature, so a return triggers a reassessment.
    reviewerRequests: actions
      .filter((x) => x.kind === "return" || (x.kind === "override" && !!x.question))
      .sort((x, y) => x.at - y.at)
      .map((x) => ({ at: new Date(x.at).toISOString(), kind: x.kind === "return" ? ("return" as const) : ("override" as const), text: x.kind === "return" ? x.reason : `Ask the customer: ${x.question}` })),
    analysis,
    statements: statements.map(toDomainStatement),
    transactions: transactions.map(toDomainTransaction),
    providerEvidence: providerEvidence.map(toDomainProviderEvidence),
    autoApproval: (c.autoApproval ?? null) as AutoApprovalEvaluation | null,
  });
  return { input, analysis, c };
}

const newest = (ctx: QueryCtx, caseId: Id<"cases">) => ctx.db.query("caseProposals").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").first();

/**
 * Called after every analysis recompute. Asks the model to reassess once no interpretation is
 * pending and the bank records are in, and never twice for the same case state.
 */
export async function maybeRequestProposal(ctx: MutationCtx, caseId: Id<"cases">) {
  if (!caseReasoningEnabled()) return;
  const statements = await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
  if (statements.some((s) => s.interpretationStatus === "pending")) return;
  const cur = await currentInput(ctx, caseId);
  if (!cur || !readyForAssessment(statements.length, (cur.c.bankFetch as { status: string }).status === "ok")) return;
  await request(ctx, caseId, cur.input, "auto");
}

async function request(ctx: MutationCtx, caseId: Id<"cases">, input: CaseReasoningInput, trigger: "auto" | "manual") {
  const signature = inputSignature(input);
  const last = await newest(ctx, caseId);
  if (last && last.signature === signature && (trigger === "auto" || last.status === "pending")) return last._id;
  const proposalId = await ctx.db.insert("caseProposals", { caseId, signature, status: "pending", trigger, input, requestedAt: Date.now() });
  const cfg = reasoningConfig();
  await logActivity(ctx, caseId, `reasoning:${cfg.mode === "live" ? cfg.label : "scripted"}`, "case_reasoning_requested", `Whole case sent to the reasoning model to reassess (${trigger === "auto" ? "the case changed" : "requested by a reviewer"}).`);
  await ctx.scheduler.runAfter(0, internal.caseReasoning.proposeLive, { proposalId });
  return proposalId;
}

/** A reviewer asks for a fresh proposal (a live, paid model call). */
export const requestProposal = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    if (!caseReasoningEnabled()) throw new Error("Case reasoning is off on this deployment (needs REASONING_PROVIDER=openai-compatible and CASE_REASONING not 'off').");
    const cur = await currentInput(ctx, caseId);
    if (!cur) throw new Error("case has no analysis yet");
    return await request(ctx, caseId, cur.input, "manual");
  },
});

export const getForAction = internalQuery({
  args: { proposalId: v.id("caseProposals") },
  handler: async (ctx, { proposalId }) => {
    const p = await ctx.db.get(proposalId);
    return p && p.status === "pending" ? { input: p.input as CaseReasoningInput } : null;
  },
});

export const applyResult = internalMutation({
  args: {
    proposalId: v.id("caseProposals"),
    provider: v.string(),
    result: v.union(v.object({ ok: v.literal(true), raw: v.any() }), v.object({ ok: v.literal(false), error: v.string() })),
  },
  handler: async (ctx, { proposalId, provider, result }) => {
    const p = await ctx.db.get(proposalId);
    if (!p || p.status !== "pending") return;
    const at = Date.now();
    const actor = `reasoning:${provider}`;
    if (!result.ok) {
      await ctx.db.patch(proposalId, { status: "failed", provider, completedAt: at, error: result.error.slice(0, 400) });
      await logActivity(ctx, p.caseId, actor, "integration_error", `Case reasoning FAILED: ${result.error}. No decision was proposed; the rule-based route stands.`);
      return;
    }
    const parsed = CaseProposalOutput.safeParse(result.raw);
    const checked = parsed.success ? validateProposal(parsed.data, p.input as CaseReasoningInput) : { ok: false as const, problems: ["output did not match the proposal schema"] };
    if (!checked.ok) {
      await ctx.db.patch(proposalId, { status: "rejected_by_validation", provider, completedAt: at, problems: checked.problems });
      await logActivity(ctx, p.caseId, "validator", "findings_rejected", `Model decision proposal REJECTED by validation: ${checked.problems.join("; ")}. The rule-based route stands.`);
      return;
    }
    const c = await ctx.db.get(p.caseId);
    const plan = executionPlan(checked.proposal.decision, (c?.autoApproval ?? null) as AutoApprovalEvaluation | null);
    const prevRow = await lastAccepted(ctx, p.caseId);
    const prev = prevRow?.proposal as CaseProposal | undefined;
    const changeLog = diffInvestigations(prev?.investigation ? { investigation: prev.investigation, decision: prev.decision } : null, { investigation: checked.proposal.investigation, decision: checked.proposal.decision });
    await ctx.db.patch(proposalId, { status: "done", provider, completedAt: at, proposal: checked.proposal, problems: checked.problems, plan, changeLog });
    if (changeLog.length) await logActivity(ctx, p.caseId, actor, "investigation_updated", `Investigation updated: ${changeLog.map((x) => x.text).join("; ")}`.slice(0, 1000));
    await logActivity(ctx, p.caseId, actor, "case_decision_proposed", `MODEL PROPOSES: ${checked.proposal.decision.replace("_", " ")}. ${plan.note}`);
    if (checked.proposal.decision === "deny") {
      // A rule-based approval that the model now disputes goes to a person; nothing is reversed.
      for (const d of await ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", p.caseId)).collect()) {
        if (d.needsReview) continue;
        await ctx.db.patch(d._id, { needsReview: { at, reason: "The reasoning model proposed a denial after this approval." } });
      }
    }
  },
});

/**
 * The newest assessment for a case and whether it was made for the case as it stands now, the
 * newest accepted one (what the workspace shows while a reassessment runs), and the history of
 * accepted assessments with their recorded changes.
 */
export const latest = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const p = await newest(ctx, caseId);
    const cur = await currentInput(ctx, caseId);
    const signature = cur ? inputSignature(cur.input) : null;
    const rows = await ctx.db.query("caseProposals").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").take(50);
    const strip = (r: Doc<"caseProposals">) => ({ ...r, input: undefined, current: r.signature === signature });
    const accepted = rows.filter((r) => r.status === "done");
    return {
      enabled: caseReasoningEnabled(),
      proposal: p ? strip(p) : null,
      accepted: accepted[0] ? strip(accepted[0]) : null,
      // Every assessment, including failed and rejected ones, so the record shows what happened and when.
      history: rows.map((r) => ({
        _id: r._id,
        status: r.status,
        trigger: r.trigger,
        requestedAt: r.requestedAt,
        completedAt: r.completedAt ?? r.requestedAt,
        provider: r.provider ?? null,
        decision: (r.proposal as CaseProposal | undefined)?.decision ?? null,
        changeLog: r.changeLog ?? [],
        resolution: r.resolution ?? null,
        problems: r.problems ?? [],
        error: r.error ?? null,
        current: r.signature === signature,
      })),
    };
  },
});

/**
 * A person answers a proposal that needs one: accept or reject, with a note. Accepting an approval
 * records the decision and schedules the SIMULATED payout; accepting a denial records it. The
 * amount and record come from the case, never from the client.
 */
export const resolve = mutation({
  args: { proposalId: v.id("caseProposals"), accept: v.boolean(), note: v.string() },
  handler: async (ctx, { proposalId, accept, note }) => {
    const p = await ctx.db.get(proposalId);
    if (!p || p.status !== "done" || !p.plan) throw new Error("proposal not found or not ready");
    if (p.resolution) throw new Error("this proposal was already answered");
    if (p.plan.kind !== "needs_person_to_approve" && p.plan.kind !== "needs_person_to_confirm_denial") throw new Error("this proposal doesn't need a person");
    const last = await newest(ctx, p.caseId);
    const cur = await currentInput(ctx, p.caseId);
    if (last?._id !== p._id || !cur || inputSignature(cur.input) !== p.signature) throw new Error("the case has changed since this proposal; ask for a new one");
    const trimmed = note.trim().slice(0, 1000);
    if (!accept && !trimmed) throw new Error("rejecting a proposal needs a reason");
    const at = Date.now();
    const existing = await ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", p.caseId)).collect();
    let decisionId: Id<"reimbursementDecisions"> | undefined;
    if (accept && p.plan.kind === "needs_person_to_approve") {
      if (existing.length) throw new Error("this case already has an approval");
      const ref = cur.analysis.match.matchedRef;
      const t = ref ? (await loadCaseInput(ctx, p.caseId)).transactions.find((x) => x.ref === ref) : undefined;
      if (!ref || !t) throw new Error("no matched bank record to approve");
      const evaluation = (cur.c.autoApproval ?? null) as AutoApprovalEvaluation | null;
      decisionId = await ctx.db.insert("reimbursementDecisions", {
        caseId: p.caseId,
        txnRef: ref,
        amount: t.amount,
        policy: "reviewer",
        outcome: "approved_by_person",
        checks: evaluation?.checks ?? [],
        decidedAt: at,
        payout: { simulated: true, status: "pending" },
      });
      await ctx.scheduler.runAfter(0, internal.payout.payDecision, { decisionId });
    }
    if (accept && p.plan.kind === "needs_person_to_confirm_denial" && existing.some((d) => !d.needsReview)) throw new Error("an approval exists that hasn't been reviewed; resolve it first");
    await ctx.db.patch(proposalId, { resolution: { accepted: accept, note: trimmed, at, ...(decisionId ? { decisionId } : {}) } });
    const what = p.plan.kind === "needs_person_to_approve" ? "approval" : "denial";
    await logActivity(
      ctx,
      p.caseId,
      "human",
      accept ? (what === "approval" ? "approved_by_person" : "denial_confirmed") : "proposal_rejected",
      accept
        ? what === "approval"
          ? `A person APPROVED the model's proposal: $${(await ctx.db.get(decisionId!))!.amount.toFixed(2)}. SIMULATED payout scheduled.${trimmed ? ` Note: ${trimmed}` : ""}`
          : `A person CONFIRMED the model's proposed denial.${trimmed ? ` Note: ${trimmed}` : ""} The customer must get a written explanation.`
        : `A person REJECTED the model's proposed ${what}: ${trimmed}`,
    );
  },
});

/** The model's question, when its assessment of the case as it stands now asks for information. */
export async function modelQuestionFor(ctx: QueryCtx, caseId: Id<"cases">): Promise<{ key: string; text: string } | null> {
  const p = await newest(ctx, caseId);
  // A question the bank's reviewer wrote (an override to "ask the customer") comes first, until the model has reassessed after it.
  const action = await ctx.db.query("reviewActions").withIndex("by_case", (q) => q.eq("caseId", caseId)).order("desc").first();
  if (action?.kind === "override" && action.decision === "request_information" && action.question && (!p || action.at > (p.completedAt ?? p.requestedAt))) {
    return { key: `reviewer:${action._id}`, text: action.question };
  }
  if (!p || p.status !== "done") return null;
  const proposal = p.proposal as { decision?: string; nextQuestion?: string | null } | undefined;
  if (proposal?.decision !== "request_information" || !proposal.nextQuestion) return null;
  const cur = await currentInput(ctx, caseId);
  if (!cur || inputSignature(cur.input) !== p.signature) return null;
  return { key: `model:${p._id}`, text: proposal.nextQuestion };
}

/**
 * A person decides differently from the newest proposal. The override is recorded with its reason as
 * the human-authorized handling. Nothing is executed by it: no payout, no letter is sent. Approving
 * money is never an override; it needs a proposed approval (or policy AUTO-1) and the payout path.
 * "Ask the customer" with a question makes that question the next one on the customer's call-back.
 */
export const override = mutation({
  args: {
    proposalId: v.id("caseProposals"),
    decision: v.union(v.literal("deny"), v.literal("escalate"), v.literal("request_information")),
    reason: v.string(),
    question: v.optional(v.string()),
  },
  handler: async (ctx, { proposalId, decision, reason, question }) => {
    const p = await ctx.db.get(proposalId);
    if (!p || p.status !== "done") throw new Error("proposal not found or not ready");
    const last = await newest(ctx, p.caseId);
    if (last?._id !== p._id) throw new Error("a newer assessment exists; decide on that one");
    if (p.resolution) throw new Error("this proposal was already answered");
    const trimmed = reason.trim().slice(0, 1000);
    if (!trimmed) throw new Error("an override needs a reason");
    const q = question?.trim().slice(0, 300) || undefined;
    if (decision === "request_information" && !q) throw new Error("say what to ask the customer");
    const proposal = p.proposal as CaseProposal | undefined;
    if (proposal?.decision === decision) throw new Error("that is the proposed decision; authorize it instead");
    const at = Date.now();
    const id = await ctx.db.insert("reviewActions", { caseId: p.caseId, proposalId, kind: "override", decision, reason: trimmed, ...(q ? { question: q } : {}), at });
    await logActivity(
      ctx,
      p.caseId,
      "human",
      "proposal_overridden",
      `A person OVERRODE the model's proposed ${proposal?.decision?.replace(/_/g, " ") ?? "step"} with: ${decision.replace(/_/g, " ")}. Reason: ${trimmed}${q ? ` Question for the customer: ${q}` : ""}`,
    );
    return id;
  },
});

/**
 * A person sends the case back to the investigator with the work they want done. The request is
 * recorded, and with live reasoning on the model reassesses the case with that request in its input.
 */
export const returnToAgent = mutation({
  args: { caseId: v.id("cases"), proposalId: v.optional(v.id("caseProposals")), request: v.string() },
  handler: async (ctx, { caseId, proposalId, request: text }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("case not found");
    const trimmed = text.trim().slice(0, 1000);
    if (!trimmed) throw new Error("say what should be looked into");
    const at = Date.now();
    const id = await ctx.db.insert("reviewActions", { caseId, ...(proposalId ? { proposalId } : {}), kind: "return", reason: trimmed, at });
    await logActivity(ctx, caseId, "human", "returned_to_investigator", `A person RETURNED the case to the investigator: ${trimmed}`);
    const live = caseReasoningEnabled();
    if (live) {
      const cur = await currentInput(ctx, caseId);
      if (cur) await request(ctx, caseId, cur.input, "manual");
    }
    return { id, reassessing: live };
  },
});

/** The input the next assessment would be built from (for inspection and tests). */
export async function currentReasoningInput(ctx: QueryCtx, caseId: Id<"cases">): Promise<CaseReasoningInput | null> {
  return (await currentInput(ctx, caseId))?.input ?? null;
}
