/**
 * Investigation workflow: a pure function from case evidence to analysis.
 *
 *   Intake → Retrieve evidence → Match transactions → Clarify facts →
 *   Assess supported considerations → Prepare packet → Human review
 *
 * Conflicts or ambiguity always route back to "clarify_facts". The output only ever
 * RECOMMENDS; approving, paying, or filing anything is outside this function.
 */
import { aggregateFacts, type ClaimFacts } from "./facts";
import { partitionFindings, type EvidenceIndex, type RejectedFinding } from "./findings";
import { matchTransactions, type MatchResult } from "./matching";
import { assessConsiderations, REGULATORY_REFS, type Consideration } from "./regulatory";
import { FRAUD_FINDER_PRODUCT, fraudRiskBand } from "./fraudSignals";
import type {
  Finding,
  OpenQuestion,
  ProviderEvidence,
  RecommendedAction,
  Statement,
  TransactionEvidence,
  WorkflowStage,
} from "./schemas";

export type EvidenceFetchState =
  | { status: "never" }
  | { status: "ok"; at: number; count: number }
  | { status: "error"; at: number; error: string };

export interface CaseInput {
  statements: Statement[];
  transactions: TransactionEvidence[];
  providerEvidence: ProviderEvidence[];
  bankFetch: EvidenceFetchState;
  /** Findings proposed by a live model, validated here before acceptance. */
  proposedFindings?: unknown[];
}

export interface Recommendation {
  action: RecommendedAction;
  rationale: string;
  blockingQuestionIds: string[];
}

export interface DraftPacket {
  readyForHumanReview: boolean;
  matchedTransactionRef: string | null;
  summary: string[];
  findingIds: string[];
  considerationRefs: string[];
  openQuestionIds: string[];
  recommendation: Recommendation;
  notice: string;
}

export interface CaseAnalysis {
  stage: WorkflowStage;
  facts: ClaimFacts;
  match: MatchResult;
  findings: Finding[];
  rejectedFindings: RejectedFinding[];
  questions: OpenQuestion[];
  considerations: Consideration[];
  recommendation: Recommendation;
  packet: DraftPacket;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Lower is asked first. Safety and missing evidence come before detail. */
export const QUESTION_PRIORITY: Record<OpenQuestion["kind"], number> = {
  narrative: 0,
  evidence_unavailable: 1,
  conflict: 2,
  multiple_amounts: 3,
  missing_transaction_details: 3,
  no_match: 4,
  ambiguous_match: 4,
  tentative_match: 4,
  initiation: 5,
  credential_sharing: 6,
  code_purpose: 7,
  payment_purpose: 7,
  identity_review: 9,
};

export function buildEvidenceIndex(input: CaseInput): EvidenceIndex {
  return {
    statementRefs: new Set(input.statements.map((s) => s.ref)),
    transactions: new Map(input.transactions.map((t) => [t.ref, t])),
    providerRefs: new Set(input.providerEvidence.map((p) => p.ref)),
    regulatoryRefs: REGULATORY_REFS,
  };
}

export function analyzeCase(input: CaseInput): CaseAnalysis {
  const facts = aggregateFacts(input.statements);
  // "I sent it" plus a reported deception (in any statement) is a customer-initiated scam payment.
  const customerSentAfterDeception =
    facts.authorization?.value === "authorized_induced" || (facts.authorization?.value === "authorized" && facts.scamIndicators.length > 0);
  const considerationFacts: ClaimFacts =
    customerSentAfterDeception && facts.authorization?.value === "authorized"
      ? { ...facts, authorization: { ...facts.authorization, value: "authorized_induced" } }
      : facts;
  const match = matchTransactions(facts, input.transactions);
  const index = buildEvidenceIndex(input);
  const txnByRef = index.transactions;
  const matchedTxn = match.matchedRef ? txnByRef.get(match.matchedRef) ?? null : null;

  const questions: OpenQuestion[] = [];
  // Questions the customer already answered "I don't know" or declined are not asked again. A
  // blocking one goes to a reviewer instead; a non-blocking one is dropped.
  const answerFor = new Map(facts.answers.map((a) => [a.key, a]));
  const q = (kind: OpenQuestion["kind"], key: string, text: string, relatedRefs: string[], opts: { blocking?: boolean; audience?: OpenQuestion["audience"] } = {}) => {
    const blocking = opts.blocking ?? true;
    const audience = opts.audience ?? "customer";
    const prior = answerFor.get(key);
    if (audience === "customer" && prior && (prior.state === "unknown" || prior.state === "declined")) {
      if (!blocking) return;
      questions.push({
        id: "", key, kind, blocking, audience: "reviewer", priority: QUESTION_PRIORITY[kind], relatedRefs: [...relatedRefs, prior.statementRef],
        text: `Customer ${prior.state === "unknown" ? "did not know" : "declined to answer"} (${prior.statementRef}): "${text}" Needs reviewer follow-up.`,
      });
      return;
    }
    questions.push({ id: "", key, kind, text, relatedRefs, blocking, audience, priority: QUESTION_PRIORITY[kind] });
  };
  const answered = (key: string) => answerFor.get(key)?.state === "answered";

  // ---- Rule-based findings (validated like any other finding) ----
  const ruleFindings: Finding[] = [];
  const f = (x: Omit<Finding, "id">) => ruleFindings.push({ id: `F${ruleFindings.length + 1}`, ...x });

  if (facts.authorization) {
    const label = {
      denies_authorization: "Customer reports they did not make this payment (someone else did, or they do not recognize it).",
      authorized_induced: "Customer reports they entered and sent the payment themselves after being deceived.",
      authorized: "Customer reports they entered and sent the payment themselves.",
      unspecified: "",
    }[facts.authorization.value];
    f({ text: label, category: "customer_statement", evidenceRefs: [facts.authorization.statementRef], status: "unverified", contradictions: [] });
  }
  for (const a of facts.amounts) {
    f({ text: `Customer reports a disputed amount of ${usd(a.value)}.`, category: "customer_statement", evidenceRefs: [a.statementRef], status: "unverified", contradictions: [] });
  }
  for (const s of facts.superseded) {
    f({ text: `Statement ${s.ref} was corrected by ${s.by} (fields: ${s.fields.join(", ")}). Original preserved.`, category: "customer_statement", evidenceRefs: [s.ref, s.by], status: "unverified", contradictions: [] });
  }
  for (const c of facts.conflicts) {
    f({
      text: `Customer statements disagree on ${c.field}.`,
      category: "customer_statement",
      evidenceRefs: [...new Set(c.values.map((v) => v.statementRef))],
      status: "disputed",
      contradictions: c.values.map((v) => `${v.statementRef}: ${v.value}`),
    });
  }
  if (matchedTxn) {
    f({
      text: `Bank record ${matchedTxn.ref}: ${usd(matchedTxn.amount)} ${matchedTxn.kind} on ${matchedTxn.date ?? "unknown date"} at ${matchedTxn.merchantName ?? "unknown merchant"} (status ${matchedTxn.status ?? "unknown"}).`,
      category: "transaction_record",
      evidenceRefs: [matchedTxn.ref],
      status: "established",
      contradictions: [],
      assertions: [{ ref: matchedTxn.ref, field: "amount", value: matchedTxn.amount }],
    });
    const cand = match.candidates[0]!;
    f({
      text: `Matcher: ${matchedTxn.ref} is the only record consistent with the reported details (${cand.reasons.map((r) => r.field).join(", ")}).`,
      category: "rule_based_inference",
      evidenceRefs: [matchedTxn.ref, ...new Set(cand.reasons.map((r) => r.statementRef))],
      status: "supported",
      contradictions: [],
    });
  }

  // ---- Open questions ----
  // Customer-facing wording asks about actions and never asks for a legal classification
  // ("was it authorized?"). Reviewer-facing questions are never read to the customer.
  if (input.statements.length === 0) {
    q("narrative", "narrative", "Please tell me what happened, starting with when you were contacted or first noticed a problem.", []);
  }
  if (input.bankFetch.status === "error") {
    q("evidence_unavailable", "evidence_unavailable", `Bank records could not be retrieved (${input.bankFetch.error}). Retry retrieval before matching.`, [], { audience: "reviewer" });
  }
  for (const c of facts.conflicts) {
    const refs = [...new Set(c.values.map((v) => v.statementRef))];
    const values = [...new Set(c.values.map((v) => v.value))];
    const text = {
      amount: `I have more than one amount noted: ${values.map((x) => usd(Number(x))).join(" and ")}. Which is the amount of the payment you're disputing, or were these different payments?`,
      date: `I have more than one date noted: ${values.join(" and ")}. Which date is right?`,
      authorization: "I want to make sure I have this right. Did you personally enter and send this payment, or did someone else do that?",
      credentialSharing: "I want to make sure I have this right. Before this payment, did anyone ask you for a code, a password, or card details? Please don't tell me the code or number itself.",
    }[c.field];
    q("conflict", `conflict:${c.field}`, text, refs);
  }
  if (input.statements.length > 0) {
    const multiAmount = input.statements.find((s) => (s.interpretation?.amounts.length ?? 0) > 1);
    if (multiAmount) q("multiple_amounts", `multiple_amounts:${multiAmount.ref}`, `You mentioned more than one amount (${multiAmount.interpretation!.amounts.map(usd).join(", ")}). Which single payment are you disputing?`, [multiAmount.ref]);

    if (input.bankFetch.status === "ok") {
      switch (match.outcome) {
        case "insufficient_facts":
          q("missing_transaction_details", "details", "What was the amount and date of the payment, and who was it to?", input.statements.map((s) => s.ref));
          break;
        case "no_match":
          q("no_match", "no_match", "I couldn't find a payment on the account with those details. Could you double-check the amount and the date?", facts.amounts.map((a) => a.statementRef));
          break;
        case "ambiguous": {
          const refs = match.candidates.map((c) => c.txnRef);
          const list = match.candidates.map((c) => {
            const t = txnByRef.get(c.txnRef);
            return t ? `${t.date ?? "?"} ${usd(t.amount)} ${t.merchantName ?? t.description ?? ""}`.trim() : c.txnRef;
          });
          q("ambiguous_match", `ambiguous:${[...refs].sort().join(",")}`, `I see more than one payment that could match: ${list.join("; ")}. Which one are you disputing?`, refs);
          break;
        }
        case "tentative": {
          const c = match.candidates[0]!;
          const t = txnByRef.get(c.txnRef);
          q("tentative_match", `tentative:${c.txnRef}`, `Is this the payment you mean: ${t ? `${usd(t.amount)} on ${t.date ?? "an unknown date"}${t.merchantName ? ` at ${t.merchantName}` : ""}` : c.txnRef}?`, [c.txnRef]);
          break;
        }
        default:
          break;
      }
    }
    if (!facts.authorization && !facts.conflicts.some((c) => c.field === "authorization")) {
      q("initiation", "initiation", "Did you personally enter and send this payment, or did someone else do that?", input.statements.map((s) => s.ref));
    }
    if (facts.authorization?.value === "denies_authorization" && !facts.credentialSharing && !facts.conflicts.some((c) => c.field === "credentialSharing")) {
      q("credential_sharing", "credentials", "Before this payment, did anyone ask you for a code, a password, or card details? Please don't tell me the code or number itself, just what kind it was.", [facts.authorization.statementRef], { blocking: false });
    }
    if (facts.credentialSharing?.value === "shared" && !answered("code_purpose")) {
      q("code_purpose", "code_purpose", "What did they tell you the code or details would be used for?", [facts.credentialSharing.statementRef], { blocking: false });
    }
    const auth = facts.authorization?.value;
    if ((auth === "authorized" || auth === "authorized_induced") && !answered("payment_purpose")) {
      q("payment_purpose", "payment_purpose", "What did you understand that payment was for, or who did you believe you were paying?", [facts.authorization!.statementRef], { blocking: false });
    }
  }

  // ---- External provider facts (CRS identity checks on SYNTHETIC-linked test personas) ----
  // Facts only. Identity inconsistencies are never treated as proof that a claim is false,
  // so they add a non-blocking reviewer note and do not change the recommendation.
  for (const result of input.providerEvidence.filter((p) => p.provider === "crs" && p.ref.endsWith(":result"))) {
    const prefix = result.ref.slice(0, -":result".length);
    const msgs = input.providerEvidence.filter((p) => p.ref.startsWith(`${prefix}:msg`));
    const persona = result.ref.split(":")[2] ?? "?";
    f({
      text: `CRS identity check (${result.product}) on test persona ${persona}${result.syntheticAssociation ? " (SYNTHETIC association with this case)" : ""}: ${result.value}${msgs.length ? ` — ${msgs.map((m) => `${m.field.replace("message_", "code ")}: ${m.value}`).join("; ")}` : ""}.`,
      category: "external_provider",
      evidenceRefs: [result.ref, ...msgs.map((m) => m.ref)],
      status: "established",
      contradictions: [],
    });
    if (msgs.length > 0) {
      q(
        "identity_review",
        `identity_review:${persona}`,
        `The identity check for linked test persona ${persona} returned ${msgs.length} issue(s). A reviewer should assess identity separately; this is not evidence that the claim is false.`,
        [result.ref, ...msgs.map((m) => m.ref)],
        { blocking: false, audience: "reviewer" },
      );
    }
  }

  // CRS Fraud Finder scores the claimant's contact details (email, phone, address), not the payment.
  for (const ff of input.providerEvidence.filter((p) => p.product === FRAUD_FINDER_PRODUCT && p.field === "risk_score")) {
    const persona = ff.ref.split(":")[2] ?? "?";
    const score = Number(ff.value);
    const band = Number.isFinite(score) ? fraudRiskBand(score) : "unreadable";
    f({
      text: `CRS Fraud Finder (email and contact risk) on test persona ${persona}${ff.syntheticAssociation ? " (SYNTHETIC association with this case)" : ""}: risk score ${ff.value} (${band}).`,
      category: "external_provider",
      evidenceRefs: [ff.ref],
      status: "established",
      contradictions: [],
    });
    if (band !== "low") {
      q(
        "identity_review",
        `fraud_risk:${persona}`,
        `Fraud Finder rated the claimant's contact details ${band} risk (score ${ff.value}). A reviewer should check the contact details; this is not evidence that the claim is false.`,
        [ff.ref],
        { blocking: false, audience: "reviewer" },
      );
    }
  }

  const considerations =
    input.statements.length > 0
      ? assessConsiderations({
          facts: considerationFacts,
          match,
          matchedTxn,
          mentionsWire: (() => {
            const refs = input.statements.filter((s) => /\bwire(?:d)?\b/i.test(s.text)).map((s) => s.ref);
            return { mentioned: refs.length > 0, refs };
          })(),
        })
      : [];

  // ---- Validate all findings (rule-based + model-proposed) ----
  const { accepted, rejected } = partitionFindings([...ruleFindings, ...(input.proposedFindings ?? [])], index);

  // ---- Order questions (stable within a priority) and number them for display ----
  questions.sort((a, b) => a.priority - b.priority);
  questions.forEach((x, i) => (x.id = `Q${i + 1}`));

  // ---- Recommendation & stage ----
  const blocking = questions.filter((x) => x.blocking);
  let recommendation: Recommendation;
  let stage: WorkflowStage;
  if (input.statements.length === 0) {
    stage = "intake";
    recommendation = { action: "request_clarification", rationale: "No customer statement recorded yet.", blockingQuestionIds: blocking.map((x) => x.id) };
  } else if (input.bankFetch.status !== "ok") {
    stage = "retrieve_evidence";
    recommendation = {
      action: "further_investigation",
      rationale: input.bankFetch.status === "error" ? "Bank record retrieval failed; evidence is incomplete." : "Bank records have not been retrieved yet.",
      blockingQuestionIds: blocking.map((x) => x.id),
    };
  } else if (blocking.length > 0) {
    stage = "clarify_facts";
    const repeatedConflict = facts.conflicts.length >= 2;
    recommendation = repeatedConflict
      ? { action: "escalate", rationale: "Multiple unresolved conflicts between customer statements; route to a human investigator.", blockingQuestionIds: blocking.map((x) => x.id) }
      : { action: "request_clarification", rationale: "Open questions must be answered before the claim can be assessed.", blockingQuestionIds: blocking.map((x) => x.id) };
  } else if (customerSentAfterDeception) {
    stage = "human_review";
    recommendation = { action: "escalate", rationale: "Customer-initiated payment after reported deception. Requires specialist scam review; not automatically reimbursable.", blockingQuestionIds: [] };
  } else if (facts.authorization?.value === "denies_authorization" && match.outcome === "clear") {
    stage = "human_review";
    recommendation = { action: "reimbursement_review", rationale: "Disputed transaction identified and customer reports it was unauthorized. A human reviewer must assess coverage and conditions; this is not an approval.", blockingQuestionIds: [] };
  } else {
    stage = "assess_considerations";
    recommendation = { action: "further_investigation", rationale: "Facts are consistent but do not fit a supported claim scenario; manual review of the claim type is needed.", blockingQuestionIds: [] };
  }

  const summary: string[] = [];
  if (matchedTxn) summary.push(`Disputed transaction: ${matchedTxn.ref} (${usd(matchedTxn.amount)}, ${matchedTxn.date ?? "?"}, ${matchedTxn.merchantName ?? "?"}).`);
  else summary.push(`Disputed transaction not yet identified (matcher outcome: ${match.outcome}).`);
  if (facts.authorization) summary.push(`Customer position (reported, unverified): ${facts.authorization.value.replace(/_/g, " ")}.`);
  summary.push(`${accepted.length} finding(s), ${questions.length} open question(s), ${considerations.length} potentially relevant consideration(s).`);

  const packet: DraftPacket = {
    readyForHumanReview: stage === "human_review",
    matchedTransactionRef: match.matchedRef,
    summary,
    findingIds: accepted.map((x) => x.id),
    considerationRefs: considerations.map((c) => c.sourceRef),
    openQuestionIds: questions.map((x) => x.id),
    recommendation,
    notice: "DRAFT for human review. Not a determination of liability, coverage, or reimbursement.",
  };

  return { stage, facts, match, findings: accepted, rejectedFindings: rejected, questions, considerations, recommendation, packet };
}
