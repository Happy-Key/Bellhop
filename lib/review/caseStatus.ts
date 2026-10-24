/**
 * What a reviewer needs first about a case: what happened, the current investigation, who has to
 * act, the proposed disposition, and any authorized outcome. Pure and browser-safe; used by the
 * claims queue query (convex/review.ts) and the case workspace.
 *
 * The source of the investigation is explicit: the reasoning model's latest accepted assessment,
 * or, when there is none, the rule-based fallback (lib/domain/investigation.ts). The two are never
 * mixed and the fallback is always labelled.
 */
import type { CaseProposal, ProposedDecision } from "../domain/caseDecision";
import { orderWorkItems, ruleBasedInvestigation, type Investigation, type WorkItem } from "../domain/investigation";
import { triageCase, type StoredAnalysis } from "../domain/triage";
import type { EvidenceFetchState } from "../domain/workflow";

export type CaseAttention = "reviewer" | "customer" | "system" | "no_report" | "decided";

export interface AssessmentRow {
  proposal: CaseProposal;
  plan: { kind: string; note: string } | null;
  provider: string | null;
  completedAt: number;
  /** Made for the case as it stands now. */
  current: boolean;
  resolution: { accepted: boolean; note: string; at: number } | null;
}

export interface OutcomeRow {
  outcome: "auto_approved" | "approved_by_person";
  amount: number;
  txnRef: string;
  policy: string;
  decidedAt: number;
  payoutStatus: "pending" | "deposited" | "failed";
  needsReview: { at: number; reason: string } | null;
}

export interface CaseStatusInput {
  analysis: StoredAnalysis | null;
  bankFetch: EvidenceFetchState;
  statementCount: number;
  /** Newest accepted model assessment, if any. */
  assessment: AssessmentRow | null;
  /** The model is reassessing right now. */
  reassessing: boolean;
  /** The newest model call failed or was rejected (shown, never replaced silently). */
  modelProblem: string | null;
  /** Live case reasoning is configured on this deployment. */
  modelEnabled: boolean;
  outcomes: OutcomeRow[];
  /** Amount of the matched bank record, for a proposed approval (computed, never from the model). */
  matchedAmount: number | null;
}

export interface Disposition {
  decision: ProposedDecision;
  summary: string;
  /** Computed from the matched bank record; only for approve. */
  amount: number | null;
  plan: { kind: string; note: string } | null;
  /** A person must authorize, and hasn't yet. */
  awaitingPerson: boolean;
  resolution: AssessmentRow["resolution"];
  current: boolean;
}

export interface AuthorizedOutcome {
  label: string;
  by: "policy" | "person";
  at: number;
  amount: number | null;
  needsReview: string | null;
}

export interface CaseStatus {
  source: "model" | "rules";
  sourceLabel: string;
  investigation: Investigation;
  /** Ordered: active work first. */
  work: WorkItem[];
  summary: string | null;
  attention: CaseAttention;
  /** One line: what happens next and who does it. */
  headline: string;
  statusLabel: string;
  /** Proposed disposition (approve, deny or escalate). request_information is a next step, not a disposition. */
  disposition: Disposition | null;
  nextQuestion: string | null;
  outcome: AuthorizedOutcome | null;
  blockers: string[];
}

export const DECISION_LABEL: Record<ProposedDecision, string> = {
  approve: "Approve reimbursement",
  deny: "Deny the claim",
  request_information: "Ask the customer",
  escalate: "Escalate to a specialist",
};

const usd = (n: number) => `$${n.toFixed(2)}`;

export function caseStatus(i: CaseStatusInput): CaseStatus {
  const triage = triageCase({ analysis: i.analysis, bankFetch: i.bankFetch, statementCount: i.statementCount });
  const a = i.assessment;
  const source: CaseStatus["source"] = a ? "model" : "rules";
  const investigation = a?.proposal.investigation ?? (i.analysis ? ruleBasedInvestigation(i.analysis, i.statementCount) : { findings: [], hypotheses: [], uncertainties: [], workItems: [], changes: [] });
  const sourceLabel = a
    ? `Reasoning model · ${a.provider?.split(":")[0] ?? "live"}${a.current ? "" : " · case changed since"}`
    : i.modelEnabled
      ? "Rule-based fallback · the model hasn't assessed this case yet"
      : "Rule-based fallback · live reasoning is off";

  const outcome = authorizedOutcome(i.outcomes, a);
  const blockers = [
    ...(i.statementCount > 0 && i.bankFetch.status !== "ok" ? ["Bank records haven't been retrieved."] : []),
    ...(i.analysis?.facts.conflicts.length ? ["The customer's statements conflict."] : []),
    ...investigation.uncertainties.filter((u) => u.blocking).map((u) => u.text),
  ];

  const p = a?.proposal ?? null;
  const disposition: Disposition | null =
    p && p.decision !== "request_information"
      ? {
          decision: p.decision,
          summary: p.summary,
          amount: p.decision === "approve" ? i.matchedAmount : null,
          plan: a!.plan,
          awaitingPerson: !!a!.plan && (a!.plan.kind === "needs_person_to_approve" || a!.plan.kind === "needs_person_to_confirm_denial") && !a!.resolution && a!.current,
          resolution: a!.resolution,
          current: a!.current,
        }
      : null;
  const nextQuestion = p?.decision === "request_information" && a!.current ? p.nextQuestion : null;

  let attention: CaseAttention;
  let headline: string;
  if (i.statementCount === 0) {
    attention = "no_report";
    headline = "Waiting for the customer's report";
  } else if (outcome?.needsReview) {
    attention = "reviewer";
    headline = `Review the approval: ${outcome.needsReview}`;
  } else if (outcome) {
    attention = "decided";
    headline = outcome.label;
  } else if (i.bankFetch.status !== "ok") {
    attention = "reviewer";
    headline = "Retrieve bank records";
  } else if (i.reassessing && (!a || !a.current)) {
    attention = "system";
    headline = "Reasoning model is reassessing the case";
  } else if (disposition?.awaitingPerson) {
    attention = "reviewer";
    headline = disposition.decision === "approve" ? `Authorize: approve${disposition.amount !== null ? ` ${usd(disposition.amount)}` : ""}` : "Confirm or reject the proposed denial";
  } else if (disposition?.resolution) {
    attention = "decided";
    headline = disposition.resolution.accepted ? (disposition.decision === "deny" ? "Denial confirmed by a person" : "Approved by a person") : `Proposal rejected by a person: ${disposition.resolution.note}`;
  } else if (disposition?.decision === "escalate") {
    attention = "reviewer";
    headline = "Specialist review";
  } else if (nextQuestion) {
    attention = "customer";
    headline = `Customer to answer: ${nextQuestion}`;
  } else if (a) {
    attention = "system";
    headline = a.current ? "Investigating" : "Waiting for the model to reassess";
  } else {
    // No model assessment: the rule-based triage decides who acts.
    attention = triage.attention === "no_report" ? "no_report" : triage.attention;
    headline = triage.headline;
  }

  const work = orderWorkItems(investigation.workItems);
  const active = work.find((w) => w.status !== "done" && w.status !== "not_needed");
  const statusLabel =
    outcome ? (outcome.needsReview ? "Approval flagged for review" : "Decided")
    : disposition?.awaitingPerson ? "Awaiting authorization"
    : disposition ? (disposition.resolution ? "Decided" : `Proposed: ${DECISION_LABEL[disposition.decision].toLowerCase()}`)
    : attention === "customer" ? "Awaiting the customer"
    : attention === "no_report" ? "No report yet"
    : active ? active.title
    : attention === "reviewer" ? "Ready for review"
    : "Investigating";

  return { source, sourceLabel, investigation, work, summary: p?.summary ?? null, attention, headline, statusLabel, disposition, nextQuestion, outcome, blockers };
}

function authorizedOutcome(outcomes: OutcomeRow[], a: AssessmentRow | null): AuthorizedOutcome | null {
  const o = outcomes[0];
  if (o) {
    return {
      label: o.outcome === "auto_approved" ? `Approved automatically under ${o.policy}: ${usd(o.amount)} (SIMULATED payout ${o.payoutStatus})` : `Approved by a person: ${usd(o.amount)} (SIMULATED payout ${o.payoutStatus})`,
      by: o.outcome === "auto_approved" ? "policy" : "person",
      at: o.decidedAt,
      amount: o.amount,
      needsReview: o.needsReview?.reason ?? null,
    };
  }
  if (a?.resolution?.accepted && a.proposal.decision === "deny") return { label: "Denial confirmed by a person", by: "person", at: a.resolution.at, amount: null, needsReview: null };
  return null;
}
