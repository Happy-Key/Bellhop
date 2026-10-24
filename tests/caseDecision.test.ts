import { describe, expect, it } from "vitest";
import { analyzeCase } from "../lib/domain/workflow";
import { interpretStatementScripted } from "../lib/domain/interpret";
import { buildCaseReasoningInput, executionPlan, inputSignature, proposedAmount, readyForAssessment, validateProposal, type CaseProposal } from "../lib/domain/caseDecision";
import { EMPTY_INVESTIGATION, diffInvestigations, ruleBasedInvestigation, type Investigation, type WorkItem } from "../lib/domain/investigation";
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
  investigation: EMPTY_INVESTIGATION,
  nextQuestion: null,
  documents: [],
  ...over,
});

describe("case decision proposals", () => {
  it("builds a model input with the rule route, evidence and citable refs, and signs it", () => {
    const { analysis, input } = clear();
    expect(analysis.questions.some((q) => q.blocking)).toBe(false);
    expect(readyForAssessment(1, true)).toBe(true);
    expect(readyForAssessment(0, true)).toBe(false);
    expect(readyForAssessment(1, false)).toBe(false);
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
    const amountWork = { key: "amount", title: "Establishing the amount", doneTitle: null, detail: "", status: "awaiting_customer" as const, outcome: null, refs: [] };
    const ask = { decision: "request_information" as const, rationale: [{ point: "Amount missing.", refs: ["S1"] }], nextQuestion: "How much was the charge?" };
    expect(validateProposal(proposal({ ...ask, investigation: { ...EMPTY_INVESTIGATION, workItems: [amountWork] }, nextQuestionFor: "amount" }), input).ok).toBe(true);
  });

  it("keeps the question tied to the model's own plan: it must advance a work item awaiting the customer", () => {
    const { input } = caseInput(["There's a charge from Volt Electronics"]);
    const work = (key: string, status: "awaiting_customer" | "done") => ({ key, title: key, doneTitle: null, detail: "", status, outcome: null, refs: [] });
    const ask = (workItems: ReturnType<typeof work>[], nextQuestionFor?: string) =>
      validateProposal(proposal({ decision: "request_information", rationale: [{ point: "Amount missing.", refs: ["S1"] }], nextQuestion: "How much was the charge?", nextQuestionFor, investigation: { ...EMPTY_INVESTIGATION, workItems } }), input);
    // No work waits on the customer: the question has nothing behind it.
    expect(ask([work("amount", "done")]).problems).toContain("nextQuestion doesn't advance any work item awaiting the customer");
    // It names finished work.
    expect(ask([work("amount", "done"), work("who", "awaiting_customer")], "amount").problems[0]).toMatch(/for work item amount, which isn't awaiting the customer \(done\)/);
    // It names nothing: linked to the item that waits on the customer, with a note.
    const linked = ask([work("who", "awaiting_customer")]);
    expect(linked.ok && linked.proposal.nextQuestionFor).toBe("who");
    expect(linked.problems).toContain("nextQuestion linked to work item who (the model didn't name one)");
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

const work = (key: string, status: WorkItem["status"], refs: string[] = []): WorkItem => ({ key, title: `Doing ${key}`, doneTitle: `Done ${key}`, detail: "d", status, outcome: status === "done" ? `outcome ${key}` : null, refs });
const inv = (over: Partial<Investigation>): Investigation => ({ ...EMPTY_INVESTIGATION, ...over });

describe("the model's investigation", () => {
  it("is reassessed whether or not the rules have blocking questions; the previous assessment doesn't change the signature", () => {
    const { input } = caseInput(["There's a charge from Volt Electronics"]);
    expect(input.caseFacts.openQuestions.some((q) => q.blocking)).toBe(true);
    const withPrev = { ...input, previous: { decision: "request_information", investigation: inv({ workItems: [work("identify_payment", "awaiting_customer")] }) } };
    expect(inputSignature(withPrev)).toBe(inputSignature(input));
  });

  it("drops items citing unknown evidence, downgrades uncorroborated findings, and lists every adjustment", () => {
    const r = validateProposal(
      proposal({
        investigation: inv({
          findings: [
            { text: "Record matches.", basis: "corroborated", refs: ["T:p-1"] },
            { text: "Customer never shared codes.", basis: "corroborated", refs: ["S1"] },
            { text: "Made up.", basis: "reported", refs: ["S9"] },
          ],
          hypotheses: [{ text: "Card testing", status: "supported", refs: [] }],
          workItems: [work("a", "done", ["T:p-1"]), work("a", "in_progress"), work("b", "in_progress", ["X:nope"])],
        }),
      }),
      clear().input,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = r.proposal.investigation;
    expect(i.findings.map((f) => [f.text, f.basis])).toEqual([["Record matches.", "corroborated"], ["Customer never shared codes.", "reported"]]);
    expect(i.hypotheses[0]!.status).toBe("open");
    expect(i.workItems.map((w) => w.key)).toEqual(["a"]);
    expect(r.problems.join(" | ")).toMatch(/shown as reported.*unknown evidence S9|unknown evidence S9.*shown as reported/s);
    expect(r.problems.join(" | ")).toMatch(/duplicate work item key a/);
  });

  it("rejects approve while the model itself lists a blocking uncertainty, and request_information without a question", () => {
    const { input } = clear();
    expect(validateProposal(proposal({ investigation: inv({ uncertainties: [{ text: "Was the card lost?", blocking: true }] }) }), input)).toMatchObject({ ok: false, problems: [expect.stringMatching(/blocking uncertainty/)] });
    expect(validateProposal(proposal({ decision: "request_information", nextQuestion: null }), input)).toMatchObject({ ok: false, problems: [expect.stringMatching(/needs a nextQuestion/)] });
  });

  it("computes a proposed approval's amount from the matched record, never from the model", () => {
    expect(proposedAmount("approve", "T:p-1", [txn])).toBe(389);
    expect(proposedAmount("escalate", "T:p-1", [txn])).toBeNull();
    expect(proposedAmount("approve", null, [txn])).toBeNull();
  });

  it("records what changed between assessments", () => {
    const before = { investigation: inv({ workItems: [work("who", "awaiting_customer"), work("old", "in_progress")], findings: [{ text: "F1", basis: "reported", refs: ["S1"] }] }), decision: "request_information" };
    const after = { investigation: inv({ workItems: [work("who", "done"), work("scam", "in_progress")], hypotheses: [{ text: "Impostor scam", status: "supported", refs: ["S2"] }], findings: [{ text: "F2", basis: "reported", refs: ["S2"] }] }), decision: "escalate" };
    expect(diffInvestigations(before, after).map((c) => c.text)).toEqual([
      "Done who: outcome who",
      "Started: Doing scam",
      "Removed from the plan: Doing old",
      "Finding: F2",
      "Finding withdrawn: F1",
      "Supported: Impostor scam",
      "Proposed: escalate (was request information)",
    ]);
    expect(diffInvestigations(after, after)).toEqual([]);
  });

  it("the rule-based fallback derives work from the analysis, labelled as such by the caller", () => {
    const { analysis } = clear();
    const r = ruleBasedInvestigation(analysis, 1);
    expect(r.workItems.map((w) => [w.key, w.status])).toEqual([["identify_payment", "done"], ["who_initiated", "done"]]);
    expect(r.findings[0]).toMatchObject({ basis: "corroborated", refs: expect.arrayContaining(["T:p-1"]) });
    const scam = caseInput(["I sent $389 to Volt Electronics because a caller from the bank told me to"]).analysis;
    expect(ruleBasedInvestigation(scam, 1).workItems.map((w) => w.key)).toContain("scam_type");
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
