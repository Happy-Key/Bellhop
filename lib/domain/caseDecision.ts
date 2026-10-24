/**
 * Case decisions proposed by the reasoning model (Bitdeer; decided by the user 2026-10-24).
 *
 * The model reads the whole case and proposes one decision with a cited rationale, its reading of
 * the curated legal sources, and draft documents. This module is pure: it builds the model input,
 * validates the output against the evidence, and decides who has to act on it.
 *
 *  - request_information / escalate: applied automatically (no money moves, nothing is decided).
 *  - approve: paid automatically only when policy AUTO-1 also passes; otherwise a person approves.
 *  - deny: always a proposal. A person confirms or rejects it (Reg E 1005.11 needs a reasonable
 *    investigation and a written explanation; automated denials drew CFPB action).
 *
 * Model output is evidence-checked, never trusted: unknown refs, uncited decisions, and denials that
 * rest only on the customer's own words are rejected.
 */
import { z } from "zod";
import type { AutoApprovalEvaluation } from "./autoApproval";
import { REGULATORY_SOURCES } from "./regulatory";
import { evidenceKindOf, type ProviderEvidence, type Statement, type TransactionEvidence } from "./schemas";
import type { CaseAnalysis } from "./workflow";

export const PROPOSED_DECISIONS = ["approve", "deny", "request_information", "escalate"] as const;
export type ProposedDecision = (typeof PROPOSED_DECISIONS)[number];

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));

/** What the model must return. Strict on structure; long text is shortened, never invented. */
export const CaseProposalOutput = z.object({
  decision: z.enum(PROPOSED_DECISIONS),
  summary: text(600).pipe(z.string().min(1)),
  rationale: z
    .array(z.object({ point: text(400).pipe(z.string().min(1)), refs: z.array(z.string()).max(10) }))
    .min(1)
    .max(8),
  legalBasis: z
    .array(z.object({ sourceRef: z.string(), reading: z.enum(["likely_applies", "likely_does_not_apply", "unclear"]), note: text(400) }))
    .max(8),
  missingInformation: z.array(text(300)).max(6),
  nextQuestion: text(300).nullable(),
  documents: z
    .array(z.object({ kind: z.enum(["investigation_summary", "customer_letter", "information_request"]), text: text(3000).pipe(z.string().min(1)) }))
    .max(3),
});
export type CaseProposal = z.infer<typeof CaseProposalOutput>;

/** Who has to act on a valid proposal. */
export type ExecutionPlan =
  | { kind: "automatic"; note: string }
  | { kind: "auto_approved"; note: string }
  | { kind: "needs_person_to_approve"; note: string }
  | { kind: "needs_person_to_confirm_denial"; note: string };

export function executionPlan(decision: ProposedDecision, autoApproval: AutoApprovalEvaluation | null): ExecutionPlan {
  switch (decision) {
    case "request_information":
      return { kind: "automatic", note: "Applied automatically: the next question goes to the customer. Nothing is decided and no money moves." };
    case "escalate":
      return { kind: "automatic", note: "Applied automatically: routed to a specialist queue. Nothing is decided and no money moves." };
    case "approve":
      return autoApproval?.eligible
        ? { kind: "auto_approved", note: `Policy ${autoApproval.policy} also passes, so the approval and the SIMULATED payout run without a person.` }
        : {
            kind: "needs_person_to_approve",
            note: `Policy ${autoApproval?.policy ?? "AUTO-1"} does not pass${autoApproval ? ` (${autoApproval.checks.filter((c) => !c.passed).map((c) => c.id).join(", ") || "no matched payment"})` : ""}, so a person approves before any payout.`,
          };
    case "deny":
      return { kind: "needs_person_to_confirm_denial", note: "Denials are never automatic. A person confirms or rejects this proposal and gives the customer a written explanation." };
  }
}

export interface CaseReasoningInput {
  caseFacts: {
    stage: string;
    ruleRoute: { action: string; rationale: string };
    matchedPaymentRef: string | null;
    matchOutcome: string;
    conflicts: string[];
    openQuestions: { key: string; audience: string; blocking: boolean; text: string }[];
  };
  statements: { ref: string; receivedAt: string; text: string; inReplyTo: string | null }[];
  bankRecords: { ref: string; kind: string; amount: number; date: string | null; payee: string | null; status: string | null }[];
  providerFacts: { ref: string; provider: string; field: string; value: string }[];
  validatedFindings: { ref: string; category: string; text: string; evidenceRefs: string[] }[];
  autoApproval: { policy: string; eligible: boolean; failedChecks: { id: string; detail: string }[] } | null;
  legalSources: { ref: string; kind: string; citation: string; excerpt: string; applicability: string }[];
  citableRefs: string[];
}

export function buildCaseReasoningInput(a: {
  analysis: CaseAnalysis;
  statements: Statement[];
  transactions: TransactionEvidence[];
  providerEvidence: ProviderEvidence[];
  autoApproval: AutoApprovalEvaluation | null;
}): CaseReasoningInput {
  const { analysis } = a;
  const refs = [...a.statements.map((s) => s.ref), ...a.transactions.map((t) => t.ref), ...a.providerEvidence.map((p) => p.ref), ...REGULATORY_SOURCES.map((s) => s.ref)];
  return {
    caseFacts: {
      stage: analysis.stage,
      ruleRoute: { action: analysis.recommendation.action, rationale: analysis.recommendation.rationale },
      matchedPaymentRef: analysis.match.matchedRef,
      matchOutcome: analysis.match.outcome,
      conflicts: analysis.facts.conflicts.map((c) => `${c.field}: ${c.values.map((v) => `${v.statementRef}=${v.value}`).join(" vs ")}`),
      openQuestions: analysis.questions.map((q) => ({ key: q.key, audience: q.audience, blocking: q.blocking, text: q.text })),
    },
    statements: a.statements.map((s) => ({ ref: s.ref, receivedAt: new Date(s.receivedAt).toISOString(), text: s.text, inReplyTo: s.inResponseTo?.text ?? null })),
    bankRecords: a.transactions.map((t) => ({ ref: t.ref, kind: t.kind, amount: t.amount, date: t.date, payee: t.merchantName ?? t.description, status: t.status })),
    providerFacts: a.providerEvidence.map((p) => ({ ref: p.ref, provider: p.provider, field: p.field, value: p.value })),
    validatedFindings: analysis.findings.map((f) => ({ ref: f.id, category: f.category, text: f.text, evidenceRefs: f.evidenceRefs })),
    autoApproval: a.autoApproval
      ? { policy: a.autoApproval.policy, eligible: a.autoApproval.eligible, failedChecks: a.autoApproval.checks.filter((c) => !c.passed).map((c) => ({ id: c.id, detail: c.detail })) }
      : null,
    legalSources: REGULATORY_SOURCES.map((s) => ({ ref: s.ref, kind: s.kind, citation: s.citation, excerpt: s.excerpt, applicability: s.applicability })),
    citableRefs: refs,
  };
}

export type ValidatedProposal = { ok: true; proposal: CaseProposal; problems: string[] } | { ok: false; problems: string[] };

/**
 * Checks a parsed proposal against the case. Problems that make the decision unsafe reject it;
 * smaller ones (an unknown ref inside a legal note) are dropped and listed.
 */
export function validateProposal(p: CaseProposal, input: CaseReasoningInput): ValidatedProposal {
  const known = new Set(input.citableRefs);
  const legal = new Set(input.legalSources.map((s) => s.ref));
  const problems: string[] = [];
  const fatal: string[] = [];

  const rationale = p.rationale.map((r) => {
    const bad = r.refs.filter((x) => !known.has(x));
    if (bad.length) fatal.push(`rationale cites unknown evidence: ${bad.join(", ")}`);
    return r;
  });
  const legalBasis = p.legalBasis.filter((l) => {
    if (legal.has(l.sourceRef)) return true;
    problems.push(`dropped legal reading of unknown source ${l.sourceRef}`);
    return false;
  });
  const cited = new Set(rationale.flatMap((r) => r.refs));
  if (cited.size === 0) fatal.push("the decision cites no evidence");

  const kinds = new Set([...cited].map(evidenceKindOf));
  if (p.decision === "approve") {
    if (!input.caseFacts.matchedPaymentRef) fatal.push("approve needs a matched bank record; none is matched");
    else if (!cited.has(input.caseFacts.matchedPaymentRef)) fatal.push(`approve must cite the matched record ${input.caseFacts.matchedPaymentRef}`);
    if (input.caseFacts.conflicts.length) fatal.push("approve while the customer's statements conflict");
  }
  if (p.decision === "deny" && !kinds.has("transaction") && !kinds.has("provider")) {
    // The customer's own words, or missing information, are never enough to deny.
    fatal.push("deny must cite a bank record or provider fact, not only customer statements");
  }
  if ((p.decision === "approve" || p.decision === "deny") && input.caseFacts.openQuestions.some((q) => q.blocking)) {
    fatal.push(`${p.decision} while blocking questions are open`);
  }
  if (fatal.length) return { ok: false, problems: [...fatal, ...problems] };
  return { ok: true, proposal: { ...p, rationale, legalBasis }, problems };
}

/** A fingerprint of everything the model reads, so the same case state isn't sent twice. */
export function inputSignature(input: CaseReasoningInput): string {
  const s = JSON.stringify({ ...input, legalSources: input.legalSources.map((l) => l.ref) });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `v1:${(h >>> 0).toString(16)}:${s.length}`;
}

/** The model is asked for a decision only when the rules have nothing blocking left to ask. */
export function readyForDecision(analysis: CaseAnalysis, statementCount: number, bankFetchOk: boolean): boolean {
  return statementCount > 0 && bankFetchOk && !analysis.questions.some((q) => q.blocking);
}
