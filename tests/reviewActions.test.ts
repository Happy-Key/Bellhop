// @vitest-environment edge-runtime
/**
 * Reviewer actions beyond answering a proposal: overriding the proposed handling, returning the
 * case to the investigator, and reviewing a flagged automatic approval. All recorded, none moves money.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { CaseProposal } from "../lib/domain/caseDecision";
import { EMPTY_INVESTIGATION } from "../lib/domain/investigation";

const modules = import.meta.glob("../convex/**/*.*s");

const txn = { ref: "T:p-1", provider: "nessie" as const, externalId: "p-1", kind: "purchase" as const, amount: 49, date: "2026-10-19", description: null, merchantId: null, merchantName: "GiftCard Hub", status: "executed", medium: "balance" };

const proposal: CaseProposal = {
  decision: "escalate",
  summary: "Customer bought a gift card on a caller's instructions.",
  rationale: [{ point: "The customer made the purchase themselves after a call from someone posing as the bank.", refs: ["S1"] }],
  legalBasis: [],
  investigation: { ...EMPTY_INVESTIGATION, workItems: [{ key: "scam_type", title: "Assessing scam type", doneTitle: "Scam type assessed", detail: "d", status: "done", outcome: "Impostor scam", refs: ["S1"] }] },
  nextQuestion: null,
  documents: [],
};

async function caseWithProposal() {
  const t = convexTest(schema, modules);
  const caseId = await t.mutation(api.cases.createSynthetic, {});
  await t.mutation(api.cases.submitStatement, { caseId, text: "Someone called pretending to be the bank and I sent $49 to GiftCard Hub because they told me to.", clientEventId: "evt-00000001" });
  await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
  const proposalId = await t.run(async (ctx) =>
    ctx.db.insert("caseProposals", {
      caseId,
      signature: "v1:test",
      status: "done",
      trigger: "auto",
      provider: "bitdeer:test",
      input: {},
      requestedAt: Date.now() - 1000,
      completedAt: Date.now() - 500,
      proposal,
      plan: { kind: "automatic", note: "Applied automatically: routed to a specialist queue." },
      changeLog: [],
    }),
  );
  return { t, caseId, proposalId };
}

describe("reviewer actions", () => {
  it("records an override with its reason and makes the reviewer's question the next one asked", async () => {
    const { t, caseId, proposalId } = await caseWithProposal();
    await expect(t.mutation(api.proposals.override, { proposalId, decision: "request_information", reason: "  " })).rejects.toThrow(/needs a reason/);
    await expect(t.mutation(api.proposals.override, { proposalId, decision: "request_information", reason: "Need the call details first" })).rejects.toThrow(/what to ask/);
    await expect(t.mutation(api.proposals.override, { proposalId, decision: "escalate", reason: "x" })).rejects.toThrow(/proposed decision/);
    await t.mutation(api.proposals.override, { proposalId, decision: "request_information", reason: "Need the call details first", question: "Roughly when did the call happen, and from what number?" });
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.reviewActions).toHaveLength(1);
    expect(view?.reviewActions[0]).toMatchObject({ kind: "override", decision: "request_information", reason: "Need the call details first", question: "Roughly when did the call happen, and from what number?", proposalId });
    expect(view?.activity.some((a) => a.kind === "proposal_overridden")).toBe(true);
    // The reviewer's question wins over the model's until the model reassesses after it.
    const q = await t.run(async (ctx) => (await import("../convex/proposals")).modelQuestionFor(ctx, caseId));
    expect(q?.text).toBe("Roughly when did the call happen, and from what number?");
    expect(q?.key).toMatch(/^reviewer:/);
    await expect(t.mutation(api.proposals.override, { proposalId, decision: "deny", reason: "again" })).resolves.toBeDefined();
  });

  it("records a return to the investigator; with live reasoning off nothing is reassessed, and the request is part of the model input", async () => {
    const { t, caseId, proposalId } = await caseWithProposal();
    await expect(t.mutation(api.proposals.returnToAgent, { caseId, proposalId, request: " " })).rejects.toThrow(/looked into/);
    const r = await t.mutation(api.proposals.returnToAgent, { caseId, proposalId, request: "Check whether the gift card balance was redeemed." });
    expect(r.reassessing).toBe(false);
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.reviewActions[0]).toMatchObject({ kind: "return", reason: "Check whether the gift card balance was redeemed." });
    const proposals = await t.run(async (ctx) => ctx.db.query("caseProposals").collect());
    expect(proposals).toHaveLength(1);
    const latest = await t.query(api.proposals.latest, { caseId });
    expect(latest.history).toHaveLength(1);
    // The request would reach the model: it is in the input the next assessment is built from.
    const input = await t.run(async (ctx) => (await import("../convex/proposals")).currentReasoningInput(ctx, caseId));
    expect(input?.reviewerRequests).toEqual([expect.objectContaining({ kind: "return", text: "Check whether the gift card balance was redeemed." })]);
  });

  it("a person reviews a flagged automatic approval: affirm clears it, a note keeps it; the payout is untouched", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    const decisionId = await t.run(async (ctx) =>
      ctx.db.insert("reimbursementDecisions", {
        caseId,
        txnRef: "T:p-1",
        amount: 49,
        policy: "AUTO-1@test",
        outcome: "auto_approved",
        checks: [],
        decidedAt: Date.now(),
        payout: { simulated: true, status: "deposited", depositId: "dep-1", at: Date.now() },
        needsReview: { at: Date.now(), reason: "Facts changed after automatic approval; now failing: no_conflicts.", failedChecks: ["no_conflicts"] },
      }),
    );
    await expect(t.mutation(api.payoutData.reviewFlaggedApproval, { decisionId, affirm: false, note: "" })).rejects.toThrow(/needs a note/);
    await t.mutation(api.payoutData.reviewFlaggedApproval, { decisionId, affirm: false, note: "Waiting for the customer's call-back." });
    let d = await t.run(async (ctx) => ctx.db.get(decisionId));
    expect(d?.needsReview?.review).toMatchObject({ affirmed: false, note: "Waiting for the customer's call-back." });
    await t.mutation(api.payoutData.reviewFlaggedApproval, { decisionId, affirm: true, note: "Conflict was a transcription slip." });
    d = await t.run(async (ctx) => ctx.db.get(decisionId));
    expect(d?.needsReview?.review).toMatchObject({ affirmed: true });
    expect(d?.payout).toMatchObject({ status: "deposited", depositId: "dep-1" });
    await expect(t.mutation(api.payoutData.reviewFlaggedApproval, { decisionId, affirm: true, note: "" })).rejects.toThrow(/already affirmed/);
    const view = await t.query(api.cases.view, { caseId: caseId as Id<"cases"> });
    expect(view?.activity.map((a) => a.kind)).toEqual(expect.arrayContaining(["approval_review_note", "approval_affirmed"]));
  });

  it("deleting a case removes its review actions too", async () => {
    const { t, caseId, proposalId } = await caseWithProposal();
    await t.mutation(api.proposals.override, { proposalId, decision: "escalate", reason: "wire fraud desk" }).catch(() => {});
    await t.mutation(api.proposals.returnToAgent, { caseId, proposalId, request: "Look again." });
    await t.mutation(api.cases.remove, { caseId });
    const rows = await t.run(async (ctx) => ctx.db.query("reviewActions").collect());
    expect(rows).toHaveLength(0);
  });
});
