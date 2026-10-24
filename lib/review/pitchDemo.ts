/**
 * The pitch demo's case, built from the scripted fixture (lib/fixtures/pitchDemo.ts) with the app's
 * real deterministic code: the scripted extractor and reply parser, analyzeCase, the proposal
 * validator, the execution plan, and policy AUTO-1. The model outputs are scripted; the controls
 * that check them are not. No Convex, Nessie or model call is made.
 */
import { interpretAnswer } from "../domain/answers";
import { evaluateAutoApproval, type AutoApprovalEvaluation } from "../domain/autoApproval";
import { buildCaseReasoningInput, executionPlan, validateProposal, type CaseProposal, type ExecutionPlan, type ValidatedProposal } from "../domain/caseDecision";
import { interpretStatementScripted } from "../domain/interpret";
import { getSource, type RegulatorySource } from "../domain/regulatory";
import type { Statement, TransactionEvidence } from "../domain/schemas";
import { analyzeCase, type CaseAnalysis } from "../domain/workflow";
import { PITCH_PROPOSAL, PITCH_START, PITCH_TRANSACTIONS, PITCH_TURNS } from "../fixtures/pitchDemo";

export interface GuardrailCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface PitchCase {
  statements: Statement[];
  transactions: TransactionEvidence[];
  analysis: CaseAnalysis;
  proposal: CaseProposal;
  validation: ValidatedProposal;
  plan: ExecutionPlan;
  autoApproval: AutoApprovalEvaluation;
  /** Code-side checks on the scripted proposal, as shown to the reviewer. */
  guardrails: GuardrailCheck[];
  /** What the same guardrails do with an approval proposal for this case (the counterfactual). */
  ifApproved: { validation: ValidatedProposal; plan: ExecutionPlan };
}

export function pitchStatements(): Statement[] {
  return PITCH_TURNS.map((t) => {
    const receivedAt = PITCH_START + t.atSec * 1000;
    const answer = interpretAnswer(t.text, t.answers);
    return {
      ref: t.ref,
      text: t.text,
      channel: "voice",
      receivedAt,
      interpretation: interpretStatementScripted(t.text, receivedAt),
      ...(t.answers ? { inResponseTo: t.answers } : {}),
      ...(answer ? { answer } : {}),
    };
  });
}

export function buildPitchCase(proposal: CaseProposal = PITCH_PROPOSAL): PitchCase {
  const statements = pitchStatements();
  const transactions = PITCH_TRANSACTIONS;
  const analysis = analyzeCase({ statements, transactions, providerEvidence: [], bankFetch: { status: "ok", at: PITCH_START, count: transactions.length } });
  const autoApproval = evaluateAutoApproval({ analysis, transactions, statements, providerEvidence: [], paymentOrigin: null, homeState: "CA" });
  const input = buildCaseReasoningInput({ analysis, statements, transactions, providerEvidence: [], autoApproval });
  const validation = validateProposal(proposal, input);
  const plan = executionPlan(proposal.decision, autoApproval);

  const known = new Set(input.citableRefs);
  const cited = proposal.rationale.flatMap((r) => r.refs);
  const guardrails: GuardrailCheck[] = [
    { label: "Every citation resolves", passed: cited.every((r) => known.has(r)), detail: `${cited.length} citations checked against the case's evidence.` },
    {
      label: "Cites the bank record",
      passed: analysis.match.matchedRef !== null && cited.includes(analysis.match.matchedRef),
      detail: analysis.match.matchedRef ? `Matched by code to ${analysis.match.matchedRef}.` : "No record is matched.",
    },
    { label: "Proposal accepted by the validator", passed: validation.ok, detail: validation.problems.length ? validation.problems.join("; ") : "No problems found." },
    {
      label: "Rule-based fallback agrees",
      passed: analysis.recommendation.action === proposal.decision,
      detail: `The rules alone would route this case to: ${analysis.recommendation.action.replace(/_/g, " ")}.`,
    },
    { label: "No money moves without a person", passed: plan.kind !== "auto_approved", detail: plan.note },
  ];

  const approve: CaseProposal = { ...proposal, decision: "approve" };
  const ifApproved = { validation: validateProposal(approve, input), plan: executionPlan("approve", autoApproval) };
  return { statements, transactions, analysis, proposal, validation, plan, autoApproval, guardrails, ifApproved };
}

/** What a ref points at, for the evidence drawer. */
export type ResolvedRef =
  | { kind: "statement"; ref: string; text: string; receivedAt: number }
  | { kind: "transaction"; ref: string; txn: TransactionEvidence }
  | { kind: "regulatory"; ref: string; source: RegulatorySource }
  | { kind: "unknown"; ref: string };

export function resolveRef(c: PitchCase, ref: string): ResolvedRef {
  const s = c.statements.find((x) => x.ref === ref);
  if (s) return { kind: "statement", ref, text: s.text, receivedAt: s.receivedAt };
  const t = c.transactions.find((x) => x.ref === ref);
  if (t) return { kind: "transaction", ref, txn: t };
  const r = getSource(ref);
  if (r) return { kind: "regulatory", ref, source: r };
  return { kind: "unknown", ref };
}
