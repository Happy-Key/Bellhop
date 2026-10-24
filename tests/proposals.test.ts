// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

const txn = { ref: "T:p-1", provider: "nessie" as const, externalId: "p-1", kind: "purchase" as const, amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "FCI Demo Volt Electronics Online", status: "executed", medium: "balance" };
const interp = { mode: "live" as const, provider: "m", amounts: [389], dates: [], merchantTerms: ["Volt Electronics"], authorization: "denies_authorization" as const, credentialSharing: "not_shared" as const, scamIndicators: [] };
const raw = (decision: string, refs: string[]) => ({
  decision,
  summary: "s",
  rationale: [{ point: "p", refs }],
  legalBasis: [],
  investigation: { findings: [{ text: "The $389 record matches.", basis: "corroborated", refs: ["T:p-1"] }], hypotheses: [], uncertainties: [], workItems: [{ key: "identify_payment", title: "Identifying the payment", doneTitle: "Payment identified", detail: "d", status: decision === "request_information" ? "awaiting_customer" : "done", outcome: null, refs: [] }], changes: [] },
  nextQuestion: decision === "request_information" ? "Did you still have your card?" : null,
  documents: [{ kind: "customer_letter", text: "Dear customer…" }],
});

/** A live-mode case at a decision point: one interpreted statement and a matched $389 record. */
async function decisionReadyCase() {
  const t = convexTest(schema, modules);
  const caseId = await t.mutation(api.cases.createSynthetic, {});
  await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
  await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $389 Volt Electronics purchase and never shared codes", clientEventId: "evt-00000001" });
  const s = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
  await t.mutation(internal.statements.applyInterpretation, { statementId: s._id, attemptId: s.currentAttemptId!, interpretation: interp, proposedFindings: [], followUpQuestion: null });
  return { t, caseId };
}

async function withLive(fn: () => Promise<void>) {
  vi.useFakeTimers(); // keeps scheduled model calls and payouts from running
  process.env.REASONING_PROVIDER = "openai-compatible";
  try {
    await fn();
  } finally {
    delete process.env.REASONING_PROVIDER;
    delete process.env.CASE_REASONING;
    vi.useRealTimers();
  }
}

describe("model-proposed case decisions", () => {
  it("reassesses even while the rules still have blocking questions, keeps every assessment, and records what changed", async () => {
    await withLive(async () => {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
      await t.mutation(api.cases.submitStatement, { caseId, text: "There is a charge from Volt Electronics", clientEventId: "evt-00000001" });
      const s = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
      await t.mutation(internal.statements.applyInterpretation, { statementId: s._id, attemptId: s.currentAttemptId!, interpretation: { ...interp, amounts: [], authorization: "unspecified", credentialSharing: "unspecified" }, proposedFindings: [], followUpQuestion: null });
      const view = (await t.query(api.cases.view, { caseId }))!;
      expect((view.case.analysis as { questions: { blocking: boolean }[] }).questions.some((q) => q.blocking)).toBe(true);
      const first = (await t.query(api.proposals.latest, { caseId })).proposal!;
      expect(first).toMatchObject({ status: "pending", trigger: "auto" });
      await t.mutation(internal.proposals.applyResult, { proposalId: first._id, provider: "bitdeer:m", result: { ok: true, raw: raw("request_information", ["S1"]) } });

      const second = await t.mutation(api.proposals.requestProposal, { caseId });
      await t.mutation(internal.proposals.applyResult, { proposalId: second, provider: "bitdeer:m", result: { ok: true, raw: raw("escalate", ["T:p-1"]) } });
      const latest = await t.query(api.proposals.latest, { caseId });
      expect(latest.accepted?._id).toBe(second);
      expect(latest.history.map((h) => h.decision)).toEqual(["escalate", "request_information"]);
      expect(latest.history[0]!.changeLog.map((c) => c.text)).toEqual(["Payment identified", "Proposed: escalate (was request information)"]);
      expect(latest.history[1]!.changeLog.map((c) => c.text)).toEqual(["Started: Identifying the payment", "Finding: The $389 record matches.", "Proposed: request information"]);
      expect((await t.query(api.cases.view, { caseId }))!.activity.some((a) => a.kind === "investigation_updated")).toBe(true);
    });
  });

  it("asks the model once per case state, and not in scripted mode", async () => {
    const scripted = convexTest(schema, modules);
    const id = await scripted.mutation(api.cases.createSynthetic, {});
    await scripted.mutation(internal.cases.storeTransactions, { caseId: id, transactions: [txn], warnings: [] });
    await scripted.mutation(api.cases.submitStatement, { caseId: id, text: "I did not make the $389 Volt Electronics purchase", clientEventId: "evt-00000001" });
    expect((await scripted.query(api.proposals.latest, { caseId: id })).proposal).toBeNull();

    await withLive(async () => {
      const { t, caseId } = await decisionReadyCase();
      const first = (await t.query(api.proposals.latest, { caseId })).proposal!;
      expect(first).toMatchObject({ status: "pending", trigger: "auto", current: true });
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] }); // same evidence
      expect((await t.query(api.proposals.latest, { caseId })).proposal!._id).toBe(first._id);
    });
  });

  it("an approval AUTO-1 doesn't cover waits for a person, who can approve it (SIMULATED payout scheduled)", async () => {
    await withLive(async () => {
      const { t, caseId } = await decisionReadyCase();
      const p = (await t.query(api.proposals.latest, { caseId })).proposal!;
      await t.mutation(internal.proposals.applyResult, { proposalId: p._id, provider: "bitdeer:m", result: { ok: true, raw: raw("approve", ["T:p-1", "S1"]) } });
      const done = (await t.query(api.proposals.latest, { caseId })).proposal!;
      expect(done).toMatchObject({ status: "done", plan: { kind: "needs_person_to_approve" } });
      await t.mutation(api.proposals.resolve, { proposalId: p._id, accept: true, note: "" });
      const view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.decisions).toEqual([expect.objectContaining({ outcome: "approved_by_person", amount: 389, txnRef: "T:p-1", payout: expect.objectContaining({ status: "pending" }) })]);
      await expect(t.mutation(api.proposals.resolve, { proposalId: p._id, accept: true, note: "" })).rejects.toThrow(/already answered/);
    });
  });

  it("a denial must cite records, is never automatic, and rejecting it needs a reason", async () => {
    await withLive(async () => {
      const { t, caseId } = await decisionReadyCase();
      const p = (await t.query(api.proposals.latest, { caseId })).proposal!;
      await t.mutation(internal.proposals.applyResult, { proposalId: p._id, provider: "bitdeer:m", result: { ok: true, raw: raw("deny", ["S1"]) } });
      expect((await t.query(api.proposals.latest, { caseId })).proposal).toMatchObject({ status: "rejected_by_validation" });

      const again = await t.mutation(api.proposals.requestProposal, { caseId });
      await t.mutation(internal.proposals.applyResult, { proposalId: again, provider: "bitdeer:m", result: { ok: true, raw: raw("deny", ["T:p-1"]) } });
      expect((await t.query(api.proposals.latest, { caseId })).proposal).toMatchObject({ plan: { kind: "needs_person_to_confirm_denial" } });
      await expect(t.mutation(api.proposals.resolve, { proposalId: again, accept: false, note: " " })).rejects.toThrow(/needs a reason/);
      await t.mutation(api.proposals.resolve, { proposalId: again, accept: true, note: "Chip-and-PIN at the customer's usual store." });
      const view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.decisions).toEqual([]);
      expect(view.activity.some((a) => a.kind === "denial_confirmed")).toBe(true);
    });
  });

  it("refuses to act on a proposal made for an older case state, and records model failures", async () => {
    await withLive(async () => {
      const { t, caseId } = await decisionReadyCase();
      const p = (await t.query(api.proposals.latest, { caseId })).proposal!;
      await t.mutation(internal.proposals.applyResult, { proposalId: p._id, provider: "bitdeer:m", result: { ok: true, raw: raw("approve", ["T:p-1"]) } });
      process.env.CASE_REASONING = "off";
      await t.mutation(api.cases.submitStatement, { caseId, text: "It was on October 17", clientEventId: "evt-00000002" });
      expect((await t.query(api.proposals.latest, { caseId })).proposal?.current).toBe(false);
      await expect(t.mutation(api.proposals.resolve, { proposalId: p._id, accept: true, note: "" })).rejects.toThrow(/changed/);
      await expect(t.mutation(api.proposals.requestProposal, { caseId })).rejects.toThrow(/off/);
      delete process.env.CASE_REASONING;

      const q = await t.mutation(api.proposals.requestProposal, { caseId });
      await t.mutation(internal.proposals.applyResult, { proposalId: q, provider: "bitdeer:m", result: { ok: false, error: "HTTP 402: insufficient balance" } });
      expect((await t.query(api.proposals.latest, { caseId })).proposal).toMatchObject({ status: "failed", error: expect.stringContaining("402") });
    });
  });

  it("on a call, the model's current question leads; without one, the rule question is the logged fallback", async () => {
    await withLive(async () => {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      const r = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance: "There is a charge from Volt Electronics", utteranceKey: "k1" });
      if (!r.ok) throw new Error("not recorded");
      const s = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
      await t.mutation(internal.statements.applyInterpretation, { statementId: s._id, attemptId: s.currentAttemptId!, interpretation: { ...interp, amounts: [], authorization: "unspecified", credentialSharing: "unspecified" }, proposedFindings: [], followUpQuestion: null });
      const issue = (key: string) => t.mutation(internal.voice.issueVoiceQuestion, { sessionId: r.sessionId, idempotencyKey: key, ref: "S1", duplicate: false, awaitingInterpretation: false });

      // The model is still assessing: the rule question is used and the fallback is logged.
      const fallback = await issue(r.idempotencyKey);
      expect(fallback.question).not.toBeNull();
      expect((await t.query(api.cases.view, { caseId }))!.activity.some((a) => a.kind === "rule_question_fallback")).toBe(true);

      const p = (await t.query(api.proposals.latest, { caseId })).proposal!;
      await t.mutation(internal.proposals.applyResult, { proposalId: p._id, provider: "bitdeer:m", result: { ok: true, raw: raw("request_information", ["S1"]) } });
      const led = await issue("k-next");
      expect(led.question).toBe("Did you still have your card?");
    });
  });
});
