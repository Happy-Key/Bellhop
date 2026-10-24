/**
 * Reviewer-facing labels for machine identifiers: policy check ids, plan kinds, decisions, work
 * statuses, document kinds, payout states. Pure. The ids themselves live in lib/domain (policy AUTO-1
 * in autoApproval.ts, which is never edited for display reasons); this module only names them.
 */
import type { ProposedDecision } from "../domain/caseDecision";
import type { WorkStatus } from "../domain/investigation";
import { getDemoPersona } from "../fixtures/demoPersonas";

export const DECISION_LABEL: Record<ProposedDecision, string> = {
  approve: "Approve reimbursement",
  deny: "Deny the claim",
  request_information: "Ask the customer",
  escalate: "Escalate to a specialist",
};

/** Short form for pills and queue rows. */
export const DECISION_SHORT: Record<ProposedDecision, string> = {
  approve: "Approve",
  deny: "Deny",
  request_information: "Ask the customer",
  escalate: "Escalate",
};

export const PLAN_LABEL: Record<string, string> = {
  automatic: "Applied automatically",
  auto_approved: "Paid automatically under the small-claim policy",
  needs_person_to_approve: "Needs a person to approve",
  needs_person_to_confirm_denial: "Needs a person to confirm the denial",
};

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  in_progress: "In progress",
  awaiting_customer: "Waiting on the customer",
  awaiting_bank: "Waiting on the bank",
  done: "Done",
  not_needed: "Not needed",
};

export const HYPOTHESIS_LABEL = { open: "Being tested", supported: "Supported", ruled_out: "Ruled out" } as const;
export const READING_LABEL = { likely_applies: "Likely applies", likely_does_not_apply: "Likely doesn't apply", unclear: "Unclear" } as const;
export const BASIS_LABEL = { reported: "Reported", corroborated: "Corroborated" } as const;
export const DOC_LABEL = { investigation_summary: "Investigation summary", customer_letter: "Customer letter", information_request: "Information request" } as const;
export const DOC_AUDIENCE = { investigation_summary: "Internal", customer_letter: "To the customer", information_request: "To the customer" } as const;
export const PAYOUT_LABEL = { pending: "Payout pending", deposited: "Payout deposited (simulated)", failed: "Payout failed" } as const;

/** Policy AUTO-1 check ids (lib/domain/autoApproval.ts) in reviewer language. */
export const CHECK_LABEL: Record<string, string> = {
  ready_for_reimbursement_review: "Payment identified and nothing blocking",
  all_statements_interpreted: "Every statement has been read",
  someone_else_sent_it: "Customer says someone else made the payment",
  no_credentials_shared: "No codes or card details given away",
  no_scam_contact_reported: "No scam contact reported",
  no_conflicts: "Statements consistent with each other",
  amount_within_limit: "Amount within the automatic limit",
  reported_in_time: "Reported within the time limit",
  electronic_debit: "Electronic payment from the account",
  payment_origin_supports_claim: "Payment origin points away from the customer",
  no_prior_payments_to_merchant: "No earlier payments to this merchant",
  no_refund_received: "No refund received",
  identity_check_clear: "Identity check clear",
  fraud_risk_low: "Contact-detail risk low",
};

export const humanize = (s: string) => s.replace(/_/g, " ");

export const checkLabel = (id: string) => CHECK_LABEL[id] ?? humanize(id);

/** "AUTO-1@2026-10-24.2" → name and version; "reviewer" → a person. */
export function policyLabel(policy: string): { name: string; version: string | null } {
  if (policy === "reviewer") return { name: "Approved by a person", version: null };
  const [id, version] = policy.split("@");
  return { name: id === "AUTO-1" ? "Small-claim policy AUTO-1" : `Policy ${id}`, version: version ?? null };
}

/** The customer's name, with any demo or synthetic marker separated out so it can be shown as a badge rather than inside the name. */
export function customerName(c: { customerLabel: string; demoPersonaId?: string | null }): { name: string; note: string | null } {
  const persona = getDemoPersona(c.demoPersonaId);
  if (persona) return { name: persona.name, note: "Demo persona" };
  const m = c.customerLabel.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) return { name: m[1]!.trim(), note: /synthetic/i.test(m[2]!) ? "Synthetic customer" : m[2]!.trim() };
  return { name: c.customerLabel, note: null };
}

/** Activity kinds in reviewer language (the raw kind is kept for the audit view). */
export const ACTIVITY_LABEL: Record<string, string> = {
  case_created: "Case opened",
  account_bound: "Account bound",
  bank_records_retrieved: "Bank records retrieved",
  identity_evidence_retrieved: "Identity check",
  fraud_risk_retrieved: "Contact-risk check",
  statement_recorded: "Statement recorded",
  interpreted: "Statement read",
  interpretation_requested: "Statement sent to the model",
  interpretation_retry: "Interpretation retried",
  answer_read: "Reply read",
  case_reasoning_requested: "Reassessment requested",
  case_decision_proposed: "Model proposed a step",
  investigation_updated: "Investigation updated",
  auto_approved: "Approved automatically",
  auto_approval_needs_review: "Approval flagged",
  approved_by_person: "Approved by a person",
  denial_confirmed: "Denial confirmed",
  proposal_rejected: "Proposal rejected",
  proposal_overridden: "Overridden by a person",
  returned_to_investigator: "Returned to the investigator",
  approval_affirmed: "Flagged approval affirmed",
  approval_review_note: "Reviewer note on the approval",
  simulated_payout: "Simulated payout",
  payout_retry: "Payout retried",
  payment_origin_set: "Payment origin attached",
  crs_persona_linked: "Identity linked",
  voice_session_created: "Call started",
  voice_call_bound: "Call linked",
  sensitive_removed: "Sensitive value removed",
  question_handed_to_reviewer: "Question handed to a reviewer",
  findings_rejected: "Model output rejected",
  stale_result_discarded: "Stale result discarded",
  integration_error: "Integration error",
  warning: "Warning",
  persona_setup_started: "Demo setup started",
  persona_setup_done: "Demo setup finished",
};

export const activityLabel = (kind: string) => ACTIVITY_LABEL[kind] ?? humanize(kind);
