/**
 * Reviewer triage: which party needs to act on a case, and what the next useful steps are.
 * Pure and browser-safe; used by the claims queue query (convex/review.ts) and the case review
 * workspace. It only re-reads the stored CaseAnalysis: it never decides a claim, assigns work,
 * or invents deadlines.
 */
import { QUESTION_PRIORITY, type CaseAnalysis, type EvidenceFetchState } from "./workflow";
import type { OpenQuestion, RecommendedAction, WorkflowStage } from "./schemas";

/** CaseAnalysis as stored on the case document (rejected findings are serialized). */
export type StoredAnalysis = Omit<CaseAnalysis, "rejectedFindings"> & { rejectedFindings: { finding: string; reasons: string[] }[] };

/** Question kinds that were reviewer-only before questions carried an `audience`. */
const LEGACY_REVIEWER_KINDS = new Set<string>(["identity_review", "evidence_unavailable"]);

/**
 * Reads a case's stored analysis, filling in fields added after it was stored. An analysis is
 * recomputed only when the case's evidence changes, so cases from early 2026-10-24 keep an older
 * shape: no `facts.txnDecisions` or `facts.answers`, and questions without `key`, `audience` or
 * `priority`. That crashed the claims queue (live 2026-10-24). Recomputing old cases instead would
 * re-run AUTO-1 (and could pay them) and the reasoning model, so every reader goes through this.
 */
export function readStoredAnalysis<T extends Pick<CaseAnalysis, "facts" | "questions"> = StoredAnalysis>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as T;
  const facts = a.facts as Partial<CaseAnalysis["facts"]> & CaseAnalysis["facts"];
  return {
    ...a,
    facts: { ...facts, txnDecisions: facts.txnDecisions ?? [], answers: facts.answers ?? [] },
    questions: (a.questions ?? []).map((q: Partial<OpenQuestion> & Pick<OpenQuestion, "id" | "kind" | "text">) => ({
      ...q,
      key: q.key ?? `legacy:${q.id}`,
      audience: q.audience ?? (LEGACY_REVIEWER_KINDS.has(q.kind) ? "reviewer" : "customer"),
      priority: q.priority ?? QUESTION_PRIORITY[q.kind] ?? 9,
      relatedRefs: q.relatedRefs ?? [],
      blocking: q.blocking ?? true,
    })),
  } as T;
}

export type Attention = "reviewer" | "customer" | "no_report";

export interface NextStep {
  /** Stable identity: the question key, or a fixed key for system steps. Never a display ID. */
  key: string;
  audience: "customer" | "reviewer";
  /** What needs attention. Customer items carry the question as it would be put to the customer. */
  title: string;
  /** Why it matters operationally. */
  why: string;
  /** Evidence (or missing evidence) behind the step. */
  refs: string[];
  blocking: boolean;
  /** A working backend action the workspace can offer for this step. */
  action?: "retrieve_bank_records";
}

export interface Triage {
  attention: Attention;
  /** One-line next action for the queue. */
  headline: string;
  /** The step the headline describes: the first open step for whoever needs to act. */
  lead: NextStep | null;
  steps: NextStep[];
  customerOpen: number;
  reviewerOpen: number;
}

export const STAGE_LABEL: Record<WorkflowStage, string> = {
  intake: "Intake",
  retrieve_evidence: "Awaiting bank records",
  match_transactions: "Matching",
  clarify_facts: "Clarifying facts",
  assess_considerations: "Claim type unclear",
  prepare_packet: "Preparing packet",
  human_review: "Ready for human review",
};

export const RECOMMENDATION_LABEL: Record<RecommendedAction, string> = {
  request_clarification: "Clarification needed",
  further_investigation: "Further investigation",
  escalate: "Escalate to specialist",
  reimbursement_review: "Reimbursement review",
};

/** Operational reason for each question kind, phrased for a bank reviewer. */
export const QUESTION_WHY: Record<OpenQuestion["kind"], string> = {
  narrative: "There is no account of what happened yet.",
  evidence_unavailable: "Bank records could not be retrieved, so no payment can be matched.",
  conflict: "The customer's statements disagree. The case stays blocked until this is settled.",
  multiple_amounts: "One statement mentions several amounts, so the disputed payment is unclear.",
  missing_transaction_details: "There is not enough detail (amount, date, payee) to identify the payment.",
  no_match: "No bank record fits the reported details.",
  ambiguous_match: "More than one bank record fits the report; only the customer can say which.",
  tentative_match: "One record partly fits and needs the customer's confirmation.",
  initiation: "The review route depends on whether the customer or someone else sent the payment.",
  credential_sharing: "Context for the reviewer: whether codes or card details were shared before the payment.",
  code_purpose: "Context for scam review: what the customer was told the code was for.",
  payment_purpose: "Context for scam review: who the customer believed they were paying.",
  identity_review: "The identity check returned issues. This is not evidence that the claim is false.",
};

export function triageCase(input: { analysis: StoredAnalysis | null; bankFetch: EvidenceFetchState; statementCount: number }): Triage {
  const { analysis, bankFetch, statementCount } = input;
  const steps: NextStep[] = [];

  if (statementCount === 0) {
    steps.push({
      key: "awaiting_report",
      audience: "customer",
      title: "Waiting for the customer's report",
      why: "No statement has been recorded, so there is nothing to match or review yet.",
      refs: [],
      blocking: true,
    });
  } else if (bankFetch.status === "never") {
    steps.push({
      key: "retrieve_bank_records",
      audience: "reviewer",
      title: "Retrieve bank records",
      why: "The reported payment can't be matched until the account's records are retrieved.",
      refs: [],
      blocking: true,
      action: "retrieve_bank_records",
    });
  }

  for (const q of analysis?.questions ?? []) {
    if (statementCount === 0 && q.kind === "narrative") continue; // covered by awaiting_report
    steps.push({
      key: q.key,
      audience: q.audience,
      title: q.text,
      why: QUESTION_WHY[q.kind],
      refs: q.relatedRefs,
      blocking: q.blocking,
      ...(q.kind === "evidence_unavailable" ? { action: "retrieve_bank_records" as const } : {}),
    });
  }

  const blockingCount = steps.filter((s) => s.blocking).length;
  if (analysis && statementCount > 0 && blockingCount === 0 && (analysis.stage === "human_review" || analysis.stage === "assess_considerations")) {
    const rec = analysis.recommendation;
    steps.push({
      key: `decision:${rec.action}`,
      audience: "reviewer",
      title: analysis.stage === "human_review" ? `Decide: ${RECOMMENDATION_LABEL[rec.action].toLowerCase()}` : "Decide how to handle this claim type",
      why:
        analysis.stage === "human_review"
          ? "No blocking questions remain. The case is ready for a decision: automatic under AUTO-1 or a model proposal; a person confirms denials and approvals outside AUTO-1."
          : rec.rationale,
      refs: analysis.packet.matchedTransactionRef ? [analysis.packet.matchedTransactionRef] : [],
      blocking: false,
    });
  }

  // Blocking first; otherwise keep the analysis's priority order.
  steps.sort((a, b) => Number(b.blocking) - Number(a.blocking));

  const reviewer = steps.filter((s) => s.audience === "reviewer");
  const customer = steps.filter((s) => s.audience === "customer");
  let attention: Attention;
  if (statementCount === 0) attention = "no_report";
  else if (reviewer.some((s) => s.blocking) || (reviewer.length > 0 && !customer.some((s) => s.blocking))) attention = "reviewer";
  else if (customer.length > 0) attention = "customer";
  else attention = "reviewer";

  const lead = steps.find((s) => s.audience === (attention === "no_report" ? "customer" : attention)) ?? steps[0];
  const headline = !lead
    ? "No open steps"
    : lead.audience === "customer" && lead.key !== "awaiting_report"
      ? `Customer to answer: ${lead.title}`
      : lead.title;

  return { attention, headline, lead: lead ?? null, steps, customerOpen: customer.length, reviewerOpen: reviewer.length };
}
