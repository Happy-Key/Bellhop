/**
 * Automatic APPROVAL policy (approve-only; decided by the user 2026-10-24).
 *
 * The app may approve, and credit with a SIMULATED Nessie deposit, a claim that passes every
 * check below. It never denies: a claim that fails any check goes to a person, with the failed
 * checks shown. Denials need a reasonable investigation and a written explanation (12 CFR
 * 1005.11(c)-(d)), and denying on an automated filter alone drew CFPB action (2022), so they are
 * always human.
 *
 * Pure function. Policy changes need human review, like lib/domain/regulatory.ts.
 */
import type { CaseAnalysis } from "./workflow";
import type { Statement, TransactionEvidence } from "./schemas";

export const AUTO_APPROVAL_POLICY = {
  id: "AUTO-1",
  version: "2026-10-24",
  /** Largest claim the app may approve on its own (demo money). */
  maxAmount: 100,
  /** Days from the transaction to the first report. Stricter than Reg E's 60 days from the statement, which comes later. */
  reportWindowDays: 60,
} as const;

export interface PolicyCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export interface AutoApprovalEvaluation {
  policy: string;
  eligible: boolean;
  txnRef: string | null;
  amount: number | null;
  checks: PolicyCheck[];
}

export interface AutoApprovalInput {
  analysis: CaseAnalysis;
  transactions: TransactionEvidence[];
  statements: Statement[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const DAY_MS = 86_400_000;

export function evaluateAutoApproval({ analysis, transactions, statements }: AutoApprovalInput): AutoApprovalEvaluation {
  const { facts, match } = analysis;
  const p = AUTO_APPROVAL_POLICY;
  const txn = match.outcome === "clear" && match.matchedRef ? transactions.find((t) => t.ref === match.matchedRef) ?? null : null;
  const firstReport = statements.length ? Math.min(...statements.map((s) => s.receivedAt)) : null;
  const checks: PolicyCheck[] = [];
  const check = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });

  check(
    "ready_for_reimbursement_review",
    analysis.recommendation.action === "reimbursement_review",
    analysis.recommendation.action === "reimbursement_review"
      ? "Transaction identified and no open blocking questions."
      : `Case is not ready (${analysis.recommendation.action.replace(/_/g, " ")}): ${analysis.recommendation.rationale}`,
  );
  check(
    "all_statements_interpreted",
    facts.uninterpretedRefs.length === 0,
    facts.uninterpretedRefs.length === 0 ? "Every statement has been interpreted." : `Still being interpreted: ${facts.uninterpretedRefs.join(", ")}.`,
  );
  check(
    "someone_else_sent_it",
    facts.authorization?.value === "denies_authorization" && !facts.conflicts.some((c) => c.field === "authorization"),
    facts.authorization?.value === "denies_authorization"
      ? `Customer reports someone else made the payment (${facts.authorization.statementRef}).`
      : "Customer has not said that someone else made the payment.",
  );
  check(
    "no_credentials_shared",
    facts.credentialSharing?.value !== "shared",
    facts.credentialSharing?.value === "shared"
      ? `Customer shared a code, password or card details (${facts.credentialSharing.statementRef}): a person decides whether it was obtained by fraud.`
      : "No report of sharing a code, password or card details.",
  );
  const deceptionWithoutDenialOfSharing = facts.scamIndicators.length > 0 && facts.credentialSharing?.value !== "not_shared";
  check(
    "no_scam_contact_reported",
    !deceptionWithoutDenialOfSharing,
    deceptionWithoutDenialOfSharing
      ? `Scam contact reported (${[...new Set(facts.scamIndicators.map((s) => s.statementRef))].join(", ")}) and the customer hasn't said nothing was shared.`
      : "No scam contact reported, or the customer says nothing was shared.",
  );
  check("no_conflicts", facts.conflicts.length === 0, facts.conflicts.length === 0 ? "No contradictions between statements." : `Contradictions on: ${facts.conflicts.map((c) => c.field).join(", ")}.`);
  check(
    "amount_within_limit",
    !!txn && txn.amount > 0 && txn.amount <= p.maxAmount,
    txn ? `Amount ${usd(txn.amount)} ${txn.amount <= p.maxAmount ? "is within" : "exceeds"} the ${usd(p.maxAmount)} automatic limit.` : "No single matched transaction.",
  );
  const reportedInTime = !!txn?.date && firstReport !== null && firstReport - Date.parse(`${txn.date}T00:00:00Z`) <= p.reportWindowDays * DAY_MS;
  check(
    "reported_in_time",
    reportedInTime,
    txn?.date && firstReport !== null
      ? `Reported ${Math.max(0, Math.floor((firstReport - Date.parse(`${txn.date}T00:00:00Z`)) / DAY_MS))} day(s) after the ${txn.date} transaction (limit ${p.reportWindowDays}).`
      : "Transaction date or report date unknown.",
  );
  const wireMentioned = analysis.considerations.some((c) => c.sourceRef === "R:reg-e.1005.3c3");
  check(
    "electronic_debit",
    !!txn && txn.kind === "purchase" && !wireMentioned,
    wireMentioned ? "A wire was mentioned: wires follow different rules." : txn ? `Bank record is a ${txn.kind} from the account.` : "No matched bank record.",
  );
  const identityIssues = analysis.questions.some((q) => q.kind === "identity_review");
  check("identity_check_clear", !identityIssues, identityIssues ? "Identity check returned issues for review." : "No identity issues on record.");

  return {
    policy: `${p.id}@${p.version}`,
    eligible: checks.every((c) => c.passed),
    txnRef: txn?.ref ?? null,
    amount: txn?.amount ?? null,
    checks,
  };
}
