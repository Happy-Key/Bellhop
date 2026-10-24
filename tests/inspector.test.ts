import { describe, expect, it } from "vitest";
import { analyzeCase } from "../lib/domain/workflow";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { EMPTY_INVESTIGATION } from "../lib/domain/investigation";
import type { CaseProposal } from "../lib/domain/caseDecision";
import type { StoredAnalysis } from "../lib/domain/triage";
import type { Statement, TransactionEvidence } from "../lib/domain/schemas";
import { caseStatus } from "../lib/review/caseStatus";
import { citersOf, conditionsFor, evidenceDetail, frameworkSources, policySummary, ruleDetail, sameSelection, selectionKey } from "../lib/review/inspector";
import type { CaseView } from "../lib/review/types";

const txn: TransactionEvidence = { ref: "T:p-1", provider: "nessie", externalId: "p-1", kind: "purchase", amount: 49, date: "2026-10-19", description: "Gift card", merchantId: null, merchantName: "GiftCard Hub", status: "executed", medium: "balance" };
const text = "Someone called pretending to be the bank and I sent $49 to GiftCard Hub because they told me to.";
const stmt: Statement = { ref: "S1", text, channel: "text", receivedAt: 1, interpretation: interpretStatementScripted(text, 1) };
const analysis = { ...analyzeCase({ statements: [stmt], transactions: [txn], providerEvidence: [], bankFetch: { status: "ok", at: 1, count: 1 } }), rejectedFindings: [] } as StoredAnalysis;

const proposal: CaseProposal = {
  decision: "escalate",
  summary: "Customer bought a gift card on a caller's instructions.",
  rationale: [{ point: "The customer made the purchase on a caller's instructions.", refs: ["S1", "T:p-1"] }],
  legalBasis: [{ sourceRef: "R:reg-e.1005.2m", reading: "likely_does_not_apply", note: "The customer initiated the purchase." }],
  investigation: {
    ...EMPTY_INVESTIGATION,
    findings: [{ text: "The disputed payment is the $49 gift card purchase.", basis: "corroborated", refs: ["S1", "T:p-1"] }],
    hypotheses: [{ text: "Impostor scam", status: "supported", refs: ["S1"] }],
    workItems: [{ key: "scam_type", title: "Assessing scam type", doneTitle: "Scam type assessed", detail: "d", status: "done", outcome: "Impostor scam", refs: ["S1"] }],
  },
  nextQuestion: null,
  documents: [],
};

const view = {
  statements: [{ _id: "s1", ref: "S1", text, channel: "text", receivedAt: 1, interpretation: stmt.interpretation, interpretationStatus: "done" }],
  transactions: [{ _id: "t1", retrievedAt: 1, ...txn }],
  providerEvidence: [],
  paymentOrigins: [{ txnRef: "T:p-1", _id: "o1", txnExternalId: "p-1", channel: "card_not_present_online", device: "customer_enrolled_device", twoFactor: "passed", city: "Miami", state: "FL", synthetic: true, preset: "customer_device", setAt: 1 }],
  history: { transactions: [], providerEvidence: [] },
} as unknown as CaseView;

const status = caseStatus({ analysis, bankFetch: { status: "ok", at: 1, count: 1 }, statementCount: 1, assessment: { proposal, plan: { kind: "automatic", note: "" }, provider: "bitdeer:m", completedAt: 2, current: true, resolution: null }, reassessing: false, modelProblem: null, modelEnabled: true, outcomes: [], matchedAmount: 49 });

describe("inspector resolvers", () => {
  it("lists everything that cites one piece of evidence, from the model's assessment and the rule-based conditions", () => {
    const c = citersOf("S1", status, proposal, analysis);
    expect(c.findings.map((f) => f.text)).toEqual(["The disputed payment is the $49 gift card purchase."]);
    expect(c.hypotheses[0]).toMatchObject({ text: "Impostor scam", status: "supported" });
    expect(c.work[0]).toMatchObject({ title: "Scam type assessed", status: "done" });
    expect(c.rationale).toHaveLength(1);
    expect(c.conditions.length).toBeGreaterThan(0);
    expect(c.conditions.every((k) => k.refs.includes("S1"))).toBe(true);
    expect(citersOf("S9", status, proposal, analysis).findings).toEqual([]);
  });

  it("resolves evidence to its record, with reconciliation and payment origin, and reports a missing ref as missing", () => {
    const t = evidenceDetail(view, analysis, "T:p-1");
    expect(t.kind).toBe("transaction");
    if (t.kind === "transaction") {
      expect(t.reconciliation).toBe("matched");
      expect(t.origin?.preset).toBe("customer_device");
    }
    expect(evidenceDetail(view, analysis, "S1").kind).toBe("statement");
    expect(evidenceDetail(view, analysis, "T:nope")).toMatchObject({ kind: "missing", evidenceKind: "transaction", superseded: false });
    expect(evidenceDetail(view, analysis, "R:reg-e.1005.2m")).toMatchObject({ kind: "regulatory" });
    expect(evidenceDetail(view, analysis, "garbage")).toMatchObject({ kind: "missing", evidenceKind: null });
  });

  it("joins the model's reading of a source with the guardrail's conditions, and lists sources from both", () => {
    const r = ruleDetail(analysis, proposal, "R:reg-e.1005.2m");
    expect(r.source?.citation).toBe("12 CFR 1005.2(m)");
    expect(r.reading?.reading).toBe("likely_does_not_apply");
    expect(r.consideration?.conditions.length).toBeGreaterThan(0);
    const sources = frameworkSources(analysis, proposal);
    expect(sources[0]).toMatchObject({ ref: "R:reg-e.1005.2m", from: "model" });
    expect(sources.some((s) => s.from === "rules")).toBe(true);
    expect(conditionsFor(analysis, ["S1"]).length).toBeGreaterThan(0);
  });

  it("summarises the policy checks with reviewer labels", () => {
    const p = policySummary({ policy: "AUTO-1@v", eligible: false, txnRef: "T:p-1", amount: 49, checks: [{ id: "no_conflicts", passed: true, detail: "d" }, { id: "someone_else_sent_it", passed: false, detail: "d2" }] });
    expect(p).toMatchObject({ passed: 1, total: 2 });
    expect(p?.checks[1]?.label).toBe("Customer says someone else made the payment");
    expect(policySummary(null)).toBeNull();
  });

  it("compares selections by value", () => {
    expect(sameSelection({ kind: "evidence", ref: "S1" }, { kind: "evidence", ref: "S1" })).toBe(true);
    expect(sameSelection({ kind: "finding", index: 0 }, { kind: "uncertainty", index: 0 })).toBe(false);
    expect(selectionKey(null)).toBe("");
  });
});
