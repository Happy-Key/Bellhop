import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCaseReasoningInput, claimLean, validateProposal, type CaseProposal } from "../lib/domain/caseDecision";
import { EMPTY_INVESTIGATION } from "../lib/domain/investigation";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { parseCsv, referenceRulesFor, rulesFromCsv } from "../lib/domain/ruleRegistry";
import { RULE_REGISTRY } from "../lib/domain/ruleRegistryData";
import type { Statement, TransactionEvidence } from "../lib/domain/schemas";
import { analyzeCase } from "../lib/domain/workflow";

const csv = readFileSync(join(__dirname, "..", "legislative-reference", "fraud_claim_rule_registry.csv"), "utf8");

describe("legislative reference rule registry", () => {
  it("the generated data module matches the CSV (run `npm run build:rules` after editing it)", () => {
    expect(RULE_REGISTRY).toEqual(rulesFromCsv(csv));
    expect(RULE_REGISTRY).toHaveLength(35);
    expect(new Set(RULE_REGISTRY.map((r) => r.rule_id)).size).toBe(35);
  });

  it("parses quoted fields with commas, doubled quotes and newlines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']]);
  });

  it("indexes every case rule, details only what fits the case's lean, and keeps the prompt small", () => {
    const unknown = referenceRulesFor("unknown");
    expect(unknown.index.some((r) => r.id.startsWith("R-V"))).toBe(false);
    expect(unknown.detail.map((r) => r.id)).toEqual(expect.arrayContaining(["R-E01", "R-E03", "R-E09"]));
    expect(unknown.detail.some((r) => /^R-(W|K|F)/.test(r.id))).toBe(false);
    expect(unknown.index.some((r) => r.id === "R-W01")).toBe(true);
    const scam = referenceRulesFor("scam_induced").detail.map((r) => r.id);
    expect(scam).toEqual(expect.arrayContaining(["R-E03", "R-E09", "R-RT01"]));
    expect(scam).not.toContain("R-E01");
    const unauth = referenceRulesFor("unauthorized").detail.map((r) => r.id);
    expect(unauth).toEqual(expect.arrayContaining(["R-E01", "R-E05", "R-Z01"]));
    expect(unauth).not.toContain("R-E03");
    for (const l of ["unknown", "unauthorized", "scam_induced"] as const) expect(JSON.stringify(referenceRulesFor(l)).length).toBeLessThan(27_000);
  });

  it("the model gets the rules for its current lean and may only name registry rules it was given", () => {
    const txn: TransactionEvidence = { ref: "T:p-1", provider: "nessie", externalId: "p-1", kind: "purchase", amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "Volt Electronics", status: "executed", medium: "balance" };
    const text = "I did not make the $389 purchase at Volt Electronics";
    const statements: Statement[] = [{ ref: "S1", text, channel: "text", receivedAt: 1, interpretation: interpretStatementScripted(text, 1) }];
    const analysis = analyzeCase({ statements, transactions: [txn], providerEvidence: [], bankFetch: { status: "ok", at: 1, count: 1 } });
    expect(claimLean(analysis)).toBe("unauthorized");
    const input = buildCaseReasoningInput({ analysis, statements, transactions: [txn], providerEvidence: [], autoApproval: null });
    expect(input.referenceRules.detail.map((r) => r.id)).toContain("R-E01");
    expect(input.citableRefs.some((r) => r.startsWith("R-"))).toBe(false); // reference only, never evidence
    const p: CaseProposal = {
      decision: "escalate",
      summary: "s",
      rationale: [{ point: "p", refs: ["T:p-1"] }],
      legalBasis: [],
      investigation: { ...EMPTY_INVESTIGATION, rulesConsulted: [{ ruleId: "R-E09", why: "notice timing" }, { ruleId: "R-X99", why: "invented" }] },
      nextQuestion: null,
      documents: [],
    };
    const r = validateProposal(p, input);
    expect(r.ok && r.proposal.investigation.rulesConsulted.map((x) => x.ruleId)).toEqual(["R-E09"]);
    expect(r.problems).toContain("dropped reference rule R-X99: not in the registry the model was given");
  });
});
