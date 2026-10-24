import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseInput, type EvidenceFetchState } from "@/lib/domain/workflow";
import { triageCase, type StoredAnalysis } from "@/lib/domain/triage";
import { LEDGER, NOW, resetStatements, stmt } from "./helpers/build";

const ok = { status: "ok", at: NOW, count: LEDGER.length } as const;

function triage(over: Partial<CaseInput>) {
  const input: CaseInput = { statements: [], transactions: LEDGER, providerEvidence: [], bankFetch: ok, ...over };
  const analysis = analyzeCase(input) as unknown as StoredAnalysis;
  return triageCase({ analysis, bankFetch: input.bankFetch as EvidenceFetchState, statementCount: input.statements.length });
}

describe("reviewer triage", () => {
  beforeEach(resetStatements);

  it("a case with no statement is 'no report', waiting on the customer", () => {
    const t = triage({});
    expect(t.attention).toBe("no_report");
    expect(t.steps.map((s) => s.key)).toEqual(["awaiting_report"]);
    expect(t.steps[0]?.audience).toBe("customer");
  });

  it("asks a reviewer to retrieve bank records before anything can be matched", () => {
    const t = triage({ statements: [stmt("I did not make the $389 purchase")], transactions: [], bankFetch: { status: "never" } });
    expect(t.attention).toBe("reviewer");
    expect(t.steps[0]).toMatchObject({ key: "retrieve_bank_records", audience: "reviewer", blocking: true, action: "retrieve_bank_records" });
  });

  it("offers a retry when retrieval failed", () => {
    const t = triage({ statements: [stmt("$389 I did not make")], transactions: [], bankFetch: { status: "error", at: NOW, error: "HTTP 503" } });
    expect(t.attention).toBe("reviewer");
    expect(t.steps.find((s) => s.key === "evidence_unavailable")).toMatchObject({ audience: "reviewer", action: "retrieve_bank_records" });
  });

  it("an ambiguous match waits on the customer, keyed by the stable question key", () => {
    const t = triage({ statements: [stmt("There's a $49 charge I don't recognize")] });
    expect(t.attention).toBe("customer");
    // Two possible records: the customer is asked about the likelier one by name (a yes or no).
    const step = t.steps.find((s) => s.key === "tentative:T:ccc333");
    expect(step).toMatchObject({ audience: "customer", blocking: true });
    expect(step?.refs.sort()).toEqual(["T:ccc333", "T:ddd444"]);
    expect(t.headline).toMatch(/^Customer to answer: /);
  });

  it("a clear unauthorized claim is ready for a reviewer, and nothing is decided", () => {
    const t = triage({ statements: [stmt("I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.")] });
    expect(t.attention).toBe("reviewer");
    const decision = t.steps.find((s) => s.key.startsWith("decision:"));
    expect(decision).toMatchObject({ key: "decision:reimbursement_review", audience: "reviewer", blocking: false, refs: ["T:bbb222"] });
    expect(decision?.title).toMatch(/^Decide: /);
    expect(JSON.stringify(t)).not.toMatch(/approved|denied/i);
  });

  it("customer and reviewer items stay separate; blocking items come first", () => {
    const t = triage({ statements: [stmt("I did not make the $389 purchase"), stmt("I paid for the $389 order myself, it never arrived")] });
    expect(t.steps.every((s) => s.audience === "customer" || s.audience === "reviewer")).toBe(true);
    const firstNonBlocking = t.steps.findIndex((s) => !s.blocking);
    expect(firstNonBlocking === -1 || t.steps.slice(firstNonBlocking).every((s) => !s.blocking)).toBe(true);
    expect(t.steps.some((s) => s.key === "conflict:authorization")).toBe(true);
    expect(t.customerOpen + t.reviewerOpen).toBe(t.steps.length);
  });
});
