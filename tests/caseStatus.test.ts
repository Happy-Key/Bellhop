import { describe, expect, it } from "vitest";
import { analyzeCase } from "../lib/domain/workflow";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { EMPTY_INVESTIGATION } from "../lib/domain/investigation";
import type { CaseProposal } from "../lib/domain/caseDecision";
import type { StoredAnalysis } from "../lib/domain/triage";
import type { Statement, TransactionEvidence } from "../lib/domain/schemas";
import { caseStatus, type AssessmentRow, type CaseStatusInput } from "../lib/review/caseStatus";

const txn: TransactionEvidence = { ref: "T:p-1", provider: "nessie", externalId: "p-1", kind: "purchase", amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "Volt Electronics", status: "executed", medium: "balance" };
const stmt = (text: string): Statement => ({ ref: "S1", text, channel: "text", receivedAt: 1, interpretation: interpretStatementScripted(text, 1) });
const analysisOf = (text: string) => {
  const a = analyzeCase({ statements: [stmt(text)], transactions: [txn], providerEvidence: [], bankFetch: { status: "ok", at: 1, count: 1 } });
  return { ...a, rejectedFindings: [] } as StoredAnalysis;
};
const proposal = (decision: CaseProposal["decision"], over: Partial<CaseProposal> = {}): CaseProposal => ({
  decision,
  summary: "Customer disputes a $389 purchase.",
  rationale: [{ point: "p", refs: ["T:p-1"] }],
  legalBasis: [],
  investigation: { ...EMPTY_INVESTIGATION, workItems: [{ key: "who", title: "Establishing who made the payment", doneTitle: null, detail: "d", status: "awaiting_customer", outcome: null, refs: [] }] },
  nextQuestion: decision === "request_information" ? "Did you still have your card?" : null,
  documents: [],
  ...over,
});
const row = (p: CaseProposal, plan: AssessmentRow["plan"], over: Partial<AssessmentRow> = {}): AssessmentRow => ({ proposal: p, plan, provider: "bitdeer:m", completedAt: 2, current: true, resolution: null, ...over });
const base = (over: Partial<CaseStatusInput>): CaseStatusInput => ({
  analysis: analysisOf("I did not make the $389 purchase at Volt Electronics"),
  bankFetch: { status: "ok", at: 1, count: 1 },
  statementCount: 1,
  assessment: null,
  reassessing: false,
  modelProblem: null,
  modelEnabled: true,
  outcomes: [],
  matchedAmount: 389,
  ...over,
});

describe("case status (investigation first)", () => {
  it("falls back to the rules, labelled, when the model hasn't assessed the case", () => {
    const s = caseStatus(base({}));
    expect(s.source).toBe("rules");
    expect(s.sourceLabel).toMatch(/Rule-based fallback/);
    expect(s.work.length).toBeGreaterThan(0);
    expect(s.disposition).toBeNull();
  });

  it("a model question puts the case with the customer; work comes from the model", () => {
    const s = caseStatus(base({ assessment: row(proposal("request_information"), { kind: "automatic", note: "" }) }));
    expect(s).toMatchObject({ source: "model", attention: "customer", headline: "Customer to answer: Did you still have your card?", disposition: null });
    expect(s.work.map((w) => w.title)).toEqual(["Establishing who made the payment"]);
  });

  it("an approval outside AUTO-1 waits for a person, with the amount computed from the record", () => {
    const s = caseStatus(base({ assessment: row(proposal("approve"), { kind: "needs_person_to_approve", note: "" }) }));
    expect(s).toMatchObject({ attention: "reviewer", headline: "Authorize: approve $389.00", statusLabel: "Awaiting authorization" });
    expect(s.disposition).toMatchObject({ decision: "approve", amount: 389, awaitingPerson: true });
  });

  it("a stale proposal can't be authorized; while the model reassesses, nobody needs to act", () => {
    const s = caseStatus(base({ assessment: row(proposal("approve"), { kind: "needs_person_to_approve", note: "" }, { current: false }), reassessing: true }));
    expect(s.disposition?.awaitingPerson).toBe(false);
    expect(s.attention).toBe("system");
  });

  it("keeps a proposal, an authorized outcome and a flagged approval distinct", () => {
    const denied = caseStatus(base({ assessment: row(proposal("deny"), { kind: "needs_person_to_confirm_denial", note: "" }, { resolution: { accepted: true, note: "chip and PIN", at: 3 } }) }));
    expect(denied).toMatchObject({ attention: "decided", outcome: { label: "Denial confirmed by a person", by: "person" } });
    const flagged = caseStatus(base({ outcomes: [{ outcome: "auto_approved", amount: 49, txnRef: "T:p-1", policy: "AUTO-1", decidedAt: 3, payoutStatus: "deposited", needsReview: { at: 4, reason: "New statement" } }] }));
    expect(flagged).toMatchObject({ attention: "reviewer", statusLabel: "Approval flagged for review" });
  });

  it("blocking: missing bank records and the model's own blocking uncertainties", () => {
    const s = caseStatus(base({ bankFetch: { status: "never" }, assessment: row(proposal("escalate", { investigation: { ...EMPTY_INVESTIGATION, uncertainties: [{ text: "Was the card lost?", blocking: true }] } }), { kind: "automatic", note: "" }) }));
    expect(s.blockers).toEqual(["Bank records haven't been retrieved.", "Was the card lost?"]);
    expect(s.headline).toBe("Retrieve bank records");
  });
});

describe("case status: review actions and flagged approvals", () => {
  const later = (p: CaseProposal, plan: AssessmentRow["plan"]) => row(p, plan, { completedAt: 2 });

  it("a proposal stored before the investigation format falls back to the rules, labelled, without crashing", () => {
    const s = caseStatus(base({ assessment: row(proposal("approve", { investigation: EMPTY_INVESTIGATION }), { kind: "needs_person_to_approve", note: "" }, { legacy: true }) }));
    expect(s.source).toBe("rules");
    expect(s.sourceLabel).toMatch(/predates/);
    expect(s.work.length).toBeGreaterThan(0);
    expect(s.disposition?.decision).toBe("approve");
  });

  it("an override to ask the customer puts the reviewer's question first and ends the wait for a person", () => {
    const s = caseStatus(base({ assessment: later(proposal("deny"), { kind: "needs_person_to_confirm_denial", note: "" }), reviewActions: [{ kind: "override", decision: "request_information", reason: "Too early to deny", question: "Did you still have your card that day?", at: 5 }] }));
    expect(s).toMatchObject({ attention: "customer", headline: "Customer to answer: Did you still have your card that day?", nextQuestionBy: "reviewer" });
    expect(s.disposition).toMatchObject({ overridden: true, awaitingPerson: false });
    expect(s.outcome).toBeNull();
  });

  it("an override to deny is a person's outcome; an override to escalate puts the case with a specialist", () => {
    const denied = caseStatus(base({ assessment: later(proposal("escalate"), { kind: "automatic", note: "" }), reviewActions: [{ kind: "override", decision: "deny", reason: "Chip-and-PIN at home", at: 5 }] }));
    expect(denied).toMatchObject({ attention: "decided", outcome: { kind: "denied", by: "person" } });
    const esc = caseStatus(base({ assessment: later(proposal("deny"), { kind: "needs_person_to_confirm_denial", note: "" }), reviewActions: [{ kind: "override", decision: "escalate", reason: "Wire desk", at: 5 }] }));
    expect(esc).toMatchObject({ attention: "reviewer", statusLabel: "Escalated by a person" });
  });

  it("a return waits for the model when live reasoning is on, and is superseded by a newer assessment", () => {
    const returned = caseStatus(base({ assessment: later(proposal("escalate"), { kind: "automatic", note: "" }), reviewActions: [{ kind: "return", reason: "Check the card balance", at: 5 }] }));
    expect(returned).toMatchObject({ attention: "system", statusLabel: "Returned for more work" });
    expect(returned.returned?.reason).toBe("Check the card balance");
    const off = caseStatus(base({ modelEnabled: false, assessment: later(proposal("escalate"), { kind: "automatic", note: "" }), reviewActions: [{ kind: "return", reason: "Check the card balance", at: 5 }] }));
    expect(off.attention).toBe("reviewer");
    const superseded = caseStatus(base({ assessment: row(proposal("escalate"), { kind: "automatic", note: "" }, { completedAt: 9 }), reviewActions: [{ kind: "return", reason: "Check the card balance", at: 5 }] }));
    expect(superseded.returned).toBeNull();
    expect(superseded.headline).toBe("Specialist review");
  });

  it("a flagged approval is decided once a person affirms it, and stays flagged with a note otherwise", () => {
    const outcome = (review: { at: number; affirmed: boolean; note: string } | undefined) => [{ outcome: "auto_approved" as const, amount: 49, txnRef: "T:p-1", policy: "AUTO-1@v", decidedAt: 3, payoutStatus: "deposited" as const, needsReview: { at: 4, reason: "now failing: no_conflicts", failedChecks: ["no_conflicts"], review } }];
    const flagged = caseStatus(base({ outcomes: outcome(undefined) }));
    expect(flagged).toMatchObject({ attention: "reviewer", headline: "Review the automatic approval: 1 check no longer passes", flag: { failedChecks: ["no_conflicts"] } });
    const noted = caseStatus(base({ outcomes: outcome({ at: 5, affirmed: false, note: "waiting" }) }));
    expect(noted.flag?.review?.note).toBe("waiting");
    expect(noted.attention).toBe("reviewer");
    const affirmed = caseStatus(base({ outcomes: outcome({ at: 5, affirmed: true, note: "" }) }));
    expect(affirmed).toMatchObject({ attention: "decided", flag: null, outcome: { by: "person", kind: "approved" } });
    expect(affirmed.outcome?.label).toMatch(/affirmed by a person/);
  });
});
