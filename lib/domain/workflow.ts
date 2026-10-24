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
  const match = matchTransactions(facts, input.transactions);
  const index = buildEvidenceIndex(input);
  const txnByRef = index.transactions;
  const matchedTxn = match.matchedRef ? txnByRef.get(match.matchedRef) ?? null : null;

  const questions: OpenQuestion[] = [];
  const q = (kind: OpenQuestion["kind"], text: string, relatedRefs: string[], blocking = true) =>
    questions.push({ id: `Q${questions.length + 1}`, kind, text, relatedRefs, blocking });

  // ---- Rule-based findings (validated like any other finding) ----
  const ruleFindings: Finding[] = [];
  const f = (x: Omit<Finding, "id">) => ruleFindings.push({ id: `F${ruleFindings.length + 1}`, ...x });

  if (facts.authorization) {
    const label = {
      denies_authorization: "Customer reports they did not authorize the transaction.",
      authorized_induced: "Customer reports making the payment themselves after being deceived.",
      authorized: "Customer reports making the payment themselves.",
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
  if (input.statements.length === 0) {
    q("missing_transaction_details", "Please describe what happened: the amount, the date, and the merchant or recipient of the payment you are disputing.", []);
  }
  if (input.bankFetch.status === "error") {
    q("evidence_unavailable", `Bank records could not be retrieved (${input.bankFetch.error}). Retry retrieval before matching.`, [], true);
  }
  for (const c of facts.conflicts) {
    const refs = [...new Set(c.values.map((v) => v.statementRef))];
    q("conflict", `Your statements give different ${c.field} values (${c.values.map((v) => `${v.statementRef}: ${v.value}`).join("; ")}). Which is correct?`, refs);
  }
  if (input.statements.length > 0) {
    const multiAmount = input.statements.find((s) => (s.interpretation?.amounts.length ?? 0) > 1);
    if (multiAmount) q("multiple_amounts", `Statement ${multiAmount.ref} mentions more than one amount. Which single payment are you disputing?`, [multiAmount.ref]);

    if (input.bankFetch.status === "ok") {
      switch (match.outcome) {
        case "insufficient_facts":
          q("missing_transaction_details", "What was the amount and date of the payment, and who was it to?", input.statements.map((s) => s.ref));
          break;
        case "no_match":
          q("no_match", "No transaction on the account matches the details provided. Can you double-check the amount and date?", facts.amounts.map((a) => a.statementRef));
          break;
        case "ambiguous": {
          const list = match.candidates.map((c) => {
            const t = txnByRef.get(c.txnRef);
            return t ? `${t.date ?? "?"} ${usd(t.amount)} ${t.merchantName ?? t.description ?? ""}`.trim() : c.txnRef;
          });
          q("ambiguous_match", `Several transactions could match: ${list.join(" | ")}. Which one are you disputing (date or merchant)?`, match.candidates.map((c) => c.txnRef));
          break;
        }
        case "tentative": {
          const c = match.candidates[0]!;
          const t = txnByRef.get(c.txnRef);
          q("tentative_match", `Is this the payment you mean: ${t ? `${t.date ?? "?"} ${usd(t.amount)} ${t.merchantName ?? ""}` : c.txnRef}?${c.contradictions.length ? ` (Note: ${c.contradictions.join("; ")})` : ""}`, [c.txnRef]);
          break;
        }
        default:
          break;
      }
    }
    if (!facts.authorization && !facts.conflicts.some((c) => c.field === "authorization")) {
      q("authorization", "Did you make or approve this payment yourself (even if you were tricked into it), or was it made without your permission?", input.statements.map((s) => s.ref));
    }
    if (facts.authorization?.value === "denies_authorization" && !facts.credentialSharing) {
      q("credential_sharing", "Did you share your card number, PIN, password, or a one-time code with anyone before this payment?", [facts.authorization.statementRef], false);
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
        `The identity check for linked test persona ${persona} returned ${msgs.length} issue(s). A reviewer should assess identity separately; this is not evidence that the claim is false.`,
        [result.ref, ...msgs.map((m) => m.ref)],
        false,
      );
    }
  }

  const considerations =
    input.statements.length > 0
      ? assessConsiderations({
          facts,
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
  } else if (facts.authorization?.value === "authorized_induced") {
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
