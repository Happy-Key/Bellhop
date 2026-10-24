import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseInput } from "@/lib/domain/workflow";
import { RecommendedAction } from "@/lib/domain/schemas";
import { LEDGER, NOW, resetStatements, stmt } from "./helpers/build";

const ok = { status: "ok", at: NOW, count: LEDGER.length } as const;
const input = (over: Partial<CaseInput>): CaseInput => ({ statements: [], transactions: LEDGER, providerEvidence: [], bankFetch: ok, ...over });

describe("workflow analysis", () => {
  beforeEach(resetStatements);

  it("starts at intake and asks for details", () => {
    const a = analyzeCase(input({}));
    expect(a.stage).toBe("intake");
    expect(a.questions[0]?.kind).toBe("missing_transaction_details");
  });

  it("does not match before bank evidence is retrieved (missing evidence)", () => {
    const a = analyzeCase(input({ statements: [stmt("I did not make the $389 purchase")], transactions: [], bankFetch: { status: "never" } }));
    expect(a.stage).toBe("retrieve_evidence");
    expect(a.recommendation.action).toBe("further_investigation");
  });

  it("surfaces an external service failure as a blocking question", () => {
    const a = analyzeCase(input({ statements: [stmt("$389 I did not make")], transactions: [], bankFetch: { status: "error", at: NOW, error: "HTTP 503" } }));
    expect(a.questions.some((q) => q.kind === "evidence_unavailable" && q.blocking)).toBe(true);
    expect(a.recommendation.action).toBe("further_investigation");
  });

  it("clear unauthorized claim goes to reimbursement REVIEW with evidence-linked findings", () => {
    const a = analyzeCase(input({ statements: [stmt("I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.")] }));
    expect(a.match.outcome).toBe("clear");
    expect(a.stage).toBe("human_review");
    expect(a.recommendation.action).toBe("reimbursement_review");
    const record = a.findings.find((f) => f.category === "transaction_record");
    expect(record?.evidenceRefs).toEqual(["T:bbb222"]);
    expect(record?.status).toBe("established");
    expect(a.findings.filter((f) => f.category === "customer_statement").every((f) => f.status !== "established")).toBe(true);
    expect(a.considerations.map((c) => c.sourceRef)).toContain("R:reg-e.1005.2m");
    expect(a.packet.readyForHumanReview).toBe(true);
  });

  it("ambiguous matches produce a clarification question listing candidates", () => {
    const a = analyzeCase(input({ statements: [stmt("There's a $49 charge I don't recognize")] }));
    expect(a.stage).toBe("clarify_facts");
    const q = a.questions.find((x) => x.kind === "ambiguous_match");
    expect(q?.relatedRefs.sort()).toEqual(["T:ccc333", "T:ddd444"]);
    expect(a.recommendation.action).toBe("request_clarification");
  });

  it("a follow-up correction resolves ambiguity while preserving the original", () => {
    const s1 = stmt("There's a $49 charge I don't recognize");
    const s2 = stmt("Actually, it was the gift card one, at GiftCard Hub", { correctsRef: s1.ref });
    const a = analyzeCase(input({ statements: [s1, s2] }));
    expect(a.match.matchedRef).toBe("T:ccc333");
    expect(a.facts.amounts).toEqual([{ value: 49, statementRef: "S1" }]);
    expect(a.findings.some((f) => f.text.includes("S1 was corrected by S2"))).toBe(true);
  });

  it("a correction replaces the corrected amount", () => {
    const s1 = stmt("I did not make a $64 charge");
    const s2 = stmt("Sorry, I meant $389", { correctsRef: s1.ref });
    const a = analyzeCase(input({ statements: [s1, s2] }));
    expect(a.facts.amounts).toEqual([{ value: 389, statementRef: "S2" }]);
    expect(a.facts.conflicts).toEqual([]);
    expect(a.match.matchedRef).toBe("T:bbb222");
  });

  it("conflicting statements are not resolved silently", () => {
    const a = analyzeCase(input({
      statements: [stmt("I did not make the $389 purchase"), stmt("I paid for the $389 order myself, it never arrived")],
    }));
    expect(a.facts.conflicts.map((c) => c.field)).toContain("authorization");
    expect(a.questions.some((q) => q.kind === "conflict")).toBe(true);
    expect(a.recommendation.action).toBe("request_clarification");
    expect(a.findings.some((f) => f.status === "disputed" && f.contradictions.length === 2)).toBe(true);
  });

  it("a customer-initiated scam payment escalates and is not treated as reimbursable", () => {
    const a = analyzeCase(input({ statements: [stmt("Someone pretending to be the bank called and I sent $389 because they told me to")] }));
    expect(a.facts.authorization?.value).toBe("authorized_induced");
    expect(a.recommendation.action).toBe("escalate");
    const def = a.considerations.find((c) => c.sourceRef === "R:reg-e.1005.2m");
    expect(def?.conditions.some((k) => k.status === "contradicted")).toBe(true);
  });

  it("rejects proposed findings with unknown evidence or unsupported assertions", () => {
    const a = analyzeCase(input({
      statements: [stmt("I did not make the $389 purchase")],
      proposedFindings: [
        { id: "M1", text: "fabricated", category: "model_inference", evidenceRefs: ["T:doesnotexist"], status: "tentative", contradictions: [] },
        { id: "M2", text: "wrong amount", category: "model_inference", evidenceRefs: ["T:bbb222"], status: "tentative", contradictions: [], assertions: [{ ref: "T:bbb222", field: "amount", value: 500 }] },
        { id: "M3", text: "overclaims", category: "model_inference", evidenceRefs: ["S1"], status: "established", contradictions: [] },
        { id: "M4", text: "bad citation", category: "model_inference", evidenceRefs: ["R:made-up-law"], status: "tentative", contradictions: [] },
        { id: "M5", text: "wrong kind", category: "transaction_record", evidenceRefs: ["S1"], status: "established", contradictions: [] },
        "not even an object",
        { id: "M6", text: "Merchant category suggests online purchase", category: "model_inference", evidenceRefs: ["T:bbb222"], status: "tentative", contradictions: [] },
      ],
    }));
    const rejectedIds = a.rejectedFindings.map((r) => (r.finding as { id?: string }).id ?? "?");
    expect(rejectedIds).toEqual(["M1", "M2", "M3", "M4", "M5", "?"]);
    expect(a.findings.some((f) => f.id === "M6")).toBe(true);
  });

  it("never recommends anything beyond the four review actions", () => {
    expect(RecommendedAction.options).toEqual(["request_clarification", "further_investigation", "escalate", "reimbursement_review"]);
  });

  it("mentions of a wire surface the Reg E wire exclusion", () => {
    const a = analyzeCase(input({ statements: [stmt("I wired $389 after a scam call, they tricked me")] }));
    expect(a.considerations.map((c) => c.sourceRef)).toContain("R:reg-e.1005.3c3");
  });
});
