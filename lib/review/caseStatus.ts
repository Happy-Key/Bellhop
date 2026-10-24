/**
 * What a reviewer needs first about a case: what happened, the current investigation, who has to
 * act, the proposed disposition, any authorized outcome, and what a person has already done.
 * Pure and browser-safe; used by the claims queue query (convex/review.ts), the case workspace and
 * the pitch demo.
 *
 * Four things stay distinct everywhere they are shown:
 *  - the investigation (findings, uncertainties, hypotheses, work): the model's latest accepted
 *    assessment, or the labelled rule-based fallback; never mixed;
 *  - the proposed disposition: the model's, with the plan for who may act on it;
 *  - the authorized outcome: policy AUTO-1's, or a person's (an approval, a confirmed denial, an
 *    override), with execution (the SIMULATED payout) tracked separately;
 *  - review actions: overrides, returns and notes by a person, which change who acts next.
 */
import type { CaseProposal, ProposedDecision } from "../domain/caseDecision";
import { EMPTY_INVESTIGATION, orderWorkItems, ruleBasedInvestigation, type Investigation, type WorkItem } from "../domain/investigation";
import { triageCase, type StoredAnalysis } from "../domain/triage";
import type { EvidenceFetchState } from "../domain/workflow";
import { DECISION_LABEL } from "./labels";

export { DECISION_LABEL };

export type CaseAttention = "reviewer" | "customer" | "system" | "no_report" | "decided";

export interface AssessmentRow {
  id?: string;
  proposal: CaseProposal;
  plan: { kind: string; note: string } | null;
  provider: string | null;
  completedAt: number;
  /** Made for the case as it stands now. */
  current: boolean;
  resolution: { accepted: boolean; note: string; at: number } | null;
  /** Stored before the investigation format: its investigation is empty, so the rule-based fallback is shown for it. */
  legacy?: boolean;
}

export interface FlagReview {
  at: number;
  affirmed: boolean;
  note: string;
}

export interface OutcomeRow {
  id?: string;
  outcome: "auto_approved" | "approved_by_person";
  amount: number;
  txnRef: string;
  policy: string;
  decidedAt: number;
  payoutStatus: "pending" | "deposited" | "failed";
  needsReview: { at: number; reason: string; failedChecks?: string[]; review?: FlagReview | null } | null;
}

export type OverrideDecision = "deny" | "escalate" | "request_information";

export interface ReviewActionRow {
  id?: string;
  kind: "override" | "return" | "note";
  decision?: OverrideDecision;
  reason: string;
  question?: string;
  at: number;
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
  /** Overrides, returns and notes by a person, newest first. */
  reviewActions?: ReviewActionRow[];
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
  /** A person decided differently (see lastAction). */
  overridden: boolean;
}

export interface AuthorizedOutcome {
  kind: "approved" | "denied";
  label: string;
  by: "policy" | "person";
  at: number;
  amount: number | null;
  /** Reason the approval was flagged after the fact, when it was and hasn't been affirmed since. */
  needsReview: string | null;
  /** The override that produced a person's denial, if that is how it was decided. */
  override: ReviewActionRow | null;
}

export interface ApprovalFlag {
  decisionId: string | null;
  reason: string;
  failedChecks: string[];
  at: number;
  /** A person looked but kept the flag (with a note). */
  review: FlagReview | null;
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
  /** The next question for the customer: the reviewer's own, or the model's. */
  nextQuestion: string | null;
  nextQuestionBy: "reviewer" | "model" | null;
  outcome: AuthorizedOutcome | null;
  /** An automatic approval flagged after the facts changed, until a person affirms it. */
  flag: ApprovalFlag | null;
  /** The newest thing a person did beyond answering a proposal. */
  lastAction: ReviewActionRow | null;
  /** The case was sent back to the investigator and no newer assessment has landed yet. */
  returned: ReviewActionRow | null;
  blockers: string[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export function caseStatus(i: CaseStatusInput): CaseStatus {
  const triage = triageCase({ analysis: i.analysis, bankFetch: i.bankFetch, statementCount: i.statementCount });
  const a = i.assessment;
  const modelInvestigation = a && !a.legacy ? a.proposal.investigation : null;
  const investigation = modelInvestigation ?? (i.analysis ? ruleBasedInvestigation(i.analysis, i.statementCount) : EMPTY_INVESTIGATION);
  const source: CaseStatus["source"] = modelInvestigation ? "model" : "rules";
  const sourceLabel = modelInvestigation
    ? `Reasoning model · ${a!.provider?.split(":")[0] ?? "live"}${a!.current ? "" : " · case changed since"}`
    : a
      ? "Rule-based fallback · the model's assessment predates the investigation format"
      : i.modelEnabled
        ? "Rule-based fallback · the model hasn't assessed this case yet"
        : "Rule-based fallback · live reasoning is off";

  const actions = [...(i.reviewActions ?? [])].sort((x, y) => y.at - x.at);
  const lastAction = actions[0] ?? null;
  // A person's action counts against the assessment it was made on; a newer assessment supersedes it.
  const newerThanAssessment = (x: ReviewActionRow) => !a || x.at > a.completedAt;
  const override = lastAction?.kind === "override" && newerThanAssessment(lastAction) ? lastAction : null;
  const returned = lastAction?.kind === "return" && newerThanAssessment(lastAction) ? lastAction : null;

  const flag = approvalFlag(i.outcomes);
  const outcome = authorizedOutcome(i.outcomes, a, override);
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
          awaitingPerson: !!a!.plan && (a!.plan.kind === "needs_person_to_approve" || a!.plan.kind === "needs_person_to_confirm_denial") && !a!.resolution && a!.current && !override,
          resolution: a!.resolution,
          current: a!.current,
          overridden: !!override,
        }
      : null;
  const reviewerQuestion = override?.decision === "request_information" && override.question ? override.question : null;
  const modelQuestion = p?.decision === "request_information" && a!.current && !override ? p.nextQuestion : null;
  const nextQuestion = reviewerQuestion ?? modelQuestion;
  const nextQuestionBy: CaseStatus["nextQuestionBy"] = reviewerQuestion ? "reviewer" : modelQuestion ? "model" : null;

  let attention: CaseAttention;
  let headline: string;
  if (i.statementCount === 0) {
    attention = "no_report";
    headline = "Waiting for the customer's report";
  } else if (flag) {
    attention = "reviewer";
    const n = flag.failedChecks.length;
    headline = n ? `Review the automatic approval: ${n} check${n === 1 ? "" : "s"} no longer pass${n === 1 ? "es" : ""}` : `Review the automatic approval: ${flag.reason}`;
  } else if (outcome) {
    attention = "decided";
    headline = outcome.label;
  } else if (i.bankFetch.status !== "ok") {
    attention = "reviewer";
    headline = "Retrieve bank records";
  } else if (i.reassessing && (!a || !a.current)) {
    attention = "system";
    headline = returned ? "Returned to the investigator: the model is reassessing" : "Reasoning model is reassessing the case";
  } else if (override?.decision === "escalate") {
    attention = "reviewer";
    headline = "Specialist review (escalated by a person)";
  } else if (reviewerQuestion) {
    attention = "customer";
    headline = `Customer to answer: ${reviewerQuestion}`;
  } else if (returned) {
    attention = i.modelEnabled ? "system" : "reviewer";
    headline = i.modelEnabled ? "Returned to the investigator: waiting for the reassessment" : "Returned to the investigator, but live reasoning is off on this deployment";
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
  const statusLabel = flag
    ? "Approval flagged for review"
    : outcome
      ? "Decided"
      : override?.decision === "escalate"
        ? "Escalated by a person"
        : returned && attention === "system"
          ? "Returned for more work"
          : disposition?.awaitingPerson
            ? "Awaiting authorization"
            : disposition
              ? disposition.resolution
                ? "Decided"
                : `Proposed: ${DECISION_LABEL[disposition.decision].toLowerCase()}`
              : attention === "customer"
                ? "Awaiting the customer"
                : attention === "no_report"
                  ? "No report yet"
                  : active
                    ? active.title
                    : attention === "reviewer"
                      ? "Ready for review"
                      : "Investigating";

  return { source, sourceLabel, investigation, work, summary: p?.summary ?? null, attention, headline, statusLabel, disposition, nextQuestion, nextQuestionBy, outcome, flag, lastAction, returned, blockers };
}

function approvalFlag(outcomes: OutcomeRow[]): ApprovalFlag | null {
  const o = outcomes.find((x) => x.needsReview && !x.needsReview.review?.affirmed);
  if (!o?.needsReview) return null;
  // Flags written before failedChecks was stored carry the ids only in the reason text.
  const fromReason = o.needsReview.reason.match(/now failing: ([a-z_, ]+)./)?.[1]?.split(/,s*/).filter(Boolean) ?? [];
  return { decisionId: o.id ?? null, reason: o.needsReview.reason, failedChecks: o.needsReview.failedChecks ?? fromReason, at: o.needsReview.at, review: o.needsReview.review ?? null };
}

function authorizedOutcome(outcomes: OutcomeRow[], a: AssessmentRow | null, override: ReviewActionRow | null): AuthorizedOutcome | null {
  const o = outcomes[0];
  if (o) {
    const flagged = !!o.needsReview && !o.needsReview.review?.affirmed;
    const affirmed = !!o.needsReview?.review?.affirmed;
    return {
      kind: "approved",
      label:
        o.outcome === "auto_approved"
          ? `Approved automatically under the small-claim policy: ${usd(o.amount)}${affirmed ? ", affirmed by a person" : ""}`
          : `Approved by a person: ${usd(o.amount)}`,
      by: o.outcome === "auto_approved" && !affirmed ? "policy" : "person",
      at: o.needsReview?.review?.at ?? o.decidedAt,
      amount: o.amount,
      needsReview: flagged ? o.needsReview!.reason : null,
      override: null,
    };
  }
  if (override?.decision === "deny") return { kind: "denied", label: "Denied by a person (overriding the proposal)", by: "person", at: override.at, amount: null, needsReview: null, override };
  if (a?.resolution?.accepted && a.proposal.decision === "deny") return { kind: "denied", label: "Denial confirmed by a person", by: "person", at: a.resolution.at, amount: null, needsReview: null, override: null };
  return null;
}
