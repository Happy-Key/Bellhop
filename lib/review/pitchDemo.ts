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

// ---------- The pitch case in the workspace's shape ----------

import type { Id } from "../../convex/_generated/dataModel";
import { diffInvestigations, EMPTY_INVESTIGATION } from "../domain/investigation";
import { PITCH_MATCHED_REF, PITCH_REASONING } from "../fixtures/pitchDemo";
import type { CaseView } from "./types";

export const PITCH_CASE_ID = "demo_pitch_dw49gc" as Id<"cases">;
export const PITCH_CUSTOMER_LABEL = "Dana Whitfield (synthetic demo customer)";

/**
 * The scripted case as the case workspace reads it: the same `cases.view` and `proposals.latest`
 * shapes the live workspace subscribes to, built from the fixture, so acts 4 and 5 of the pitch
 * render the real decision, findings, rules and outputs components in demo mode. The provider is
 * labelled "scripted-replay" so the UI says so. Nothing is fetched or saved.
 */
export function pitchWorkspaceData(c: PitchCase = buildPitchCase()): { data: CaseView; proposalRow: PitchProposalRow; previousRow: PitchProposalRow } {
  const caseId = PITCH_CASE_ID;
  const assessedAt = PITCH_START + 140 * 1000;
  const statements = c.statements.map((s, i) => ({
    _id: `demo_s${i + 1}` as Id<"statements">,
    _creationTime: s.receivedAt,
    caseId,
    ref: s.ref,
    text: s.text,
    channel: s.channel,
    receivedAt: s.receivedAt,
    ...(s.inResponseTo ? { inResponseTo: s.inResponseTo } : {}),
    ...(s.answer ? { answer: s.answer } : {}),
    interpretation: s.interpretation,
    interpretationStatus: "done" as const,
  }));
  const transactions = c.transactions.map((t, i) => ({ _id: `demo_t${i + 1}` as Id<"transactions">, _creationTime: PITCH_START, caseId, retrievedAt: PITCH_START, ...t })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const activity = [
    { kind: "case_created", at: PITCH_START, actor: "customer:voice", message: "Case opened from the customer line." },
    { kind: "bank_records_retrieved", at: PITCH_START + 1000, actor: "fixture", message: "Fixture bank records loaded (4 records). Not retrieved from Nessie." },
    ...c.statements.map((s) => ({ kind: "statement_recorded", at: s.receivedAt, actor: "customer:voice", message: `${s.ref} recorded${s.inResponseTo ? ` in reply to "${s.inResponseTo.key}"` : ""}.` })),
    { kind: "case_decision_proposed", at: assessedAt, actor: "reasoning:scripted-replay", message: `MODEL PROPOSES (scripted replay): ${c.proposal.decision.replace(/_/g, " ")}. ${c.plan.note}` },
  ]
    .map((a, i) => ({ _id: `demo_a${i + 1}` as Id<"activity">, _creationTime: a.at, caseId, ...a }))
    .sort((a, b) => b.at - a.at);
  const data = {
    case: {
      _id: caseId,
      _creationTime: PITCH_START,
      title: "Pitch demo (scripted scenario)",
      synthetic: true as const,
      customerLabel: PITCH_CUSTOMER_LABEL,
      nextStatementNumber: c.statements.length + 1,
      bankFetch: { status: "ok" as const, at: PITCH_START, count: c.transactions.length },
      analysis: { ...c.analysis, rejectedFindings: [] },
      analysisVersion: c.statements.length,
      autoApproval: c.autoApproval,
      createdAt: PITCH_START,
      nessieAccountBound: false,
    },
    paymentOrigins: [],
    reviewActions: [],
    statements,
    transactions,
    providerEvidence: [],
    history: { transactions: [], providerEvidence: [] },
    decisions: [],
    activity,
  } as unknown as CaseView;
  const changeLog = diffInvestigations({ investigation: { ...EMPTY_INVESTIGATION, workItems: PITCH_REASONING.before.work }, decision: null }, { investigation: c.proposal.investigation, decision: c.proposal.decision });
  const proposalRow: PitchProposalRow = {
    _id: "demo_proposal" as Id<"caseProposals">,
    _creationTime: assessedAt,
    caseId,
    signature: "demo",
    status: "done",
    trigger: "auto",
    provider: "scripted-replay:pitch",
    requestedAt: assessedAt - 4000,
    completedAt: assessedAt,
    proposal: c.proposal,
    problems: c.validation.ok ? c.validation.problems : [],
    plan: c.plan,
    changeLog,
    current: true,
  };
  // The assessment made after S1, kept as history: the model asked who made the payment.
  const before = PITCH_REASONING.before;
  const previousProposal: CaseProposal = {
    decision: "request_information",
    summary: before.interpretation,
    rationale: [{ point: "The $49.00 gift card purchase on Oct 19 is the only record matching the customer’s report.", refs: ["S1", PITCH_MATCHED_REF] }],
    legalBasis: [],
    investigation: {
      ...EMPTY_INVESTIGATION,
      findings: [{ text: "The disputed payment is the $49.00 Demo GiftCard Hub purchase on Oct 19.", basis: "corroborated", refs: ["S1", PITCH_MATCHED_REF] }],
      uncertainties: [{ text: "Who entered and sent the payment", blocking: true }],
      workItems: before.work,
    },
    nextQuestion: before.nextQuestion,
    documents: [
      { kind: "investigation_summary", text: "Reported 2026-10-21 15:02 UTC by voice. Payment: $49.00 to Demo GiftCard Hub on 2026-10-19 (T:demo-giftcard-49), identified from the customer’s report (S1). Open: who made the payment." },
      { kind: "information_request", text: "Did you make the $49.00 GiftCard Hub purchase yourself, or did someone else make it?" },
    ],
  };
  const previousAt = PITCH_START + 55 * 1000;
  const previousRow: PitchProposalRow = {
    _id: "demo_proposal_1" as Id<"caseProposals">,
    _creationTime: previousAt,
    caseId,
    signature: "demo-1",
    status: "done",
    trigger: "auto",
    provider: "scripted-replay:pitch",
    requestedAt: previousAt - 3000,
    completedAt: previousAt,
    proposal: previousProposal,
    problems: [],
    plan: { kind: "automatic", note: "Applied automatically: the next question goes to the customer." },
    changeLog: diffInvestigations(null, { investigation: previousProposal.investigation, decision: "request_information" }),
    current: false,
  };
  return { data, proposalRow, previousRow };
}

export interface PitchProposalRow {
  _id: Id<"caseProposals">;
  _creationTime: number;
  caseId: Id<"cases">;
  signature: string;
  status: "done";
  trigger: "auto";
  provider: string;
  requestedAt: number;
  completedAt: number;
  proposal: CaseProposal;
  problems: string[];
  plan: ExecutionPlan;
  changeLog: { kind: string; text: string }[];
  current: boolean;
}
