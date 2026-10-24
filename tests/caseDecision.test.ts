import { describe, expect, it } from "vitest";
import { analyzeCase } from "../lib/domain/workflow";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { buildCaseReasoningInput, executionPlan, inputSignature, readyForDecision, validateProposal, type CaseProposal } from "../lib/domain/caseDecision";
import type { AutoApprovalEvaluation } from "../lib/domain/autoApproval";
import type { Statement, TransactionEvidence } from "../lib/domain/schemas";
import { OpenAICompatibleReasoningProvider } from "../lib/providers/reasoning";
import { ProviderError } from "../lib/providers/errors";

const txn: TransactionEvidence = { ref: "T:p-1", provider: "nessie", externalId: "p-1", kind: "purchase", amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "FCI Demo Volt Electronics Online", status: "executed", medium: "balance" };
const stmt = (ref: string, text: string): Statement => ({ ref, text, channel: "text", receivedAt: Date.UTC(2026, 9, 20), interpretation: interpretStatementScripted(text, Date.UTC(2026, 9, 20)) });

function caseInput(texts: string[], auto: AutoApprovalEvaluation | null = null) {
  const statements = texts.map((t, i) => stmt(`S${i + 1}`, t));
  const analysis = analyzeCase({ statements, transactions: [txn], providerEvidence: [], bankFetch: { status: "ok", at: 1, count: 1 } });
  return { analysis, input: buildCaseReasoningInput({ analysis, statements, transactions: [txn], providerEvidence: [], autoApproval: auto }) };
}

const clear = () => caseInput(["I did not make the $389 purchase at Volt Electronics. I never shared my card or any codes."]);
const proposal = (over: Partial<CaseProposal>): CaseProposal => ({
  decision: "approve",
  summary: "Customer disputes a $389 purchase that matches the bank record.",
  rationale: [{ point: "The record matches the reported amount and payee.", refs: ["T:p-1", "S1"] }],
  legalBasis: [{ sourceRef: "R:reg-e.1005.2m", reading: "likely_applies", note: "Initiated by someone else per the customer." }],
  missingInformation: [],
  nextQuestion: null,
  documents: [],
  ...over,
});

describe("case decision proposals", () => {
  it("builds a model input with the rule route, evidence and citable refs, and signs it", () => {
    const { analysis, input } = clear();
    expect(readyForDecision(analysis, 1, true)).toBe(true);
    expect(input.caseFacts).toMatchObject({ matchedPaymentRef: "T:p-1", ruleRoute: { action: "reimbursement_review" } });
    expect(input.citableRefs).toEqual(expect.arrayContaining(["S1", "T:p-1", "R:reg-e.1005.2m"]));
    expect(inputSignature(input)).toBe(inputSignature(clear().input));
    expect(inputSignature(input)).not.toBe(inputSignature(caseInput(["I did not make the $389 purchase at Volt Electronics."]).input));
  });

  it("accepts a cited approval and drops legal readings of unknown sources", () => {
    const r = validateProposal(proposal({ legalBasis: [{ sourceRef: "R:made-up", reading: "likely_applies", note: "x" }] }), clear().input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposal.legalBasis).toEqual([]);
    expect(r.problems).toEqual(["dropped legal reading of unknown source R:made-up"]);
  });

  it("rejects unknown evidence, uncited decisions, and denials that rest on the customer's words alone", () => {
    const { input } = clear();
    expect(validateProposal(proposal({ rationale: [{ point: "x", refs: ["T:nope"] }] }), input)).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.stringMatching(/unknown evidence/)]) });
    expect(validateProposal(proposal({ rationale: [{ point: "x", refs: [] }] }), input)).toMatchObject({ ok: false });
    expect(validateProposal(proposal({ decision: "deny", rationale: [{ point: "Customer is vague.", refs: ["S1"] }] }), input)).toMatchObject({ ok: false, problems: expect.arrayContaining([expect.stringMatching(/bank record or provider fact/)]) });
    expect(validateProposal(proposal({ decision: "deny", rationale: [{ point: "Record shows the card chip was used.", refs: ["T:p-1"] }] }), input).ok).toBe(true);
  });

  it("rejects approve or deny while blocking questions are open, but allows a request for information", () => {
    const { input } = caseInput(["There's a charge from Volt Electronics"]);
    expect(input.caseFacts.openQuestions.some((q) => q.blocking)).toBe(true);
    expect(validateProposal(proposal({ decision: "approve", rationale: [{ point: "x", refs: ["S1"] }] }), input).ok).toBe(false);
    expect(validateProposal(proposal({ decision: "request_information", rationale: [{ point: "Amount missing.", refs: ["S1"] }], nextQuestion: "How much was the charge?" }), input).ok).toBe(true);
  });

  it("acts automatically only where no person is needed", () => {
    const eligible = { policy: "AUTO-1", eligible: true, txnRef: "T:p-1", amount: 49, checks: [] } as AutoApprovalEvaluation;
    const failing = { policy: "AUTO-1", eligible: false, txnRef: "T:p-1", amount: 389, checks: [{ id: "amount_limit", passed: false, detail: "" }] } as AutoApprovalEvaluation;
    expect(executionPlan("request_information", null).kind).toBe("automatic");
    expect(executionPlan("escalate", null).kind).toBe("automatic");
    expect(executionPlan("approve", eligible).kind).toBe("auto_approved");
    expect(executionPlan("approve", failing)).toMatchObject({ kind: "needs_person_to_approve", note: expect.stringContaining("amount_limit") });
    expect(executionPlan("deny", eligible).kind).toBe("needs_person_to_confirm_denial");
  });
});

describe("OpenAI-compatible provider: case proposals", () => {
  const cfg = { baseUrl: "https://api.example.test/v1", apiKey: "sk-secret-123", model: "m", providerLabel: "bitdeer" };
  const reply = (content: string, status = 200) => async () => new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content, { status });

  it("parses a fenced JSON proposal", async () => {
    const p = new OpenAICompatibleReasoningProvider(cfg, reply("```json\n" + JSON.stringify(proposal({})) + "\n```"));
    await expect(p.proposeCase(clear().input)).resolves.toMatchObject({ decision: "approve" });
  });

  it("rejects malformed output and redacts the key from HTTP errors", async () => {
    await expect(new OpenAICompatibleReasoningProvider(cfg, reply(JSON.stringify({ decision: "pay_now" }))).proposeCase(clear().input)).rejects.toBeInstanceOf(ProviderError);
    const err = await new OpenAICompatibleReasoningProvider(cfg, reply("insufficient balance for sk-secret-123", 402)).proposeCase(clear().input).catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 402/);
    expect(String(err)).not.toMatch(/sk-secret-123/);
  });
});
