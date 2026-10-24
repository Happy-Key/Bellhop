/**
 * Pure resolvers for the case inspector: what a selection in the workspace (a piece of evidence, a
 * finding, a rule, the policy, a work item, a document) points at, and what else in the case
 * refers to it. Nothing here infers new facts: every relationship is read from stored data (the
 * model's validated assessment, the rule-based analysis, the records) and shown with its source.
 */
import type { AutoApprovalEvaluation } from "../domain/autoApproval";
import type { CaseProposal } from "../domain/caseDecision";
import { getSource, type ConditionStatus, type RegulatorySource } from "../domain/regulatory";
import { getRegistryRule } from "../domain/ruleRegistry";
import { evidenceKindOf, type EvidenceKind } from "../domain/schemas";
import type { StoredAnalysis } from "../domain/triage";
import type { CaseStatus } from "./caseStatus";
import { checkLabel } from "./labels";
import type { CaseView, ViewStatement, ViewTransaction } from "./types";
import { reconciliation, type Reconciliation } from "./workspace";

export type Selection =
  | { kind: "evidence"; ref: string }
  | { kind: "finding"; index: number }
  | { kind: "uncertainty"; index: number }
  | { kind: "hypothesis"; index: number }
  | { kind: "rule"; ref: string }
  | { kind: "registry"; id: string }
  | { kind: "policy" }
  | { kind: "work"; key: string }
  | { kind: "disposition" }
  | { kind: "outcome" }
  | { kind: "question" }
  | { kind: "document"; index: number }
  | { kind: "action"; id: string }
  | { kind: "assessment"; id: string };

export const selectionKey = (s: Selection | null | undefined): string => (s ? Object.values(s).join(":") : "");
export const sameSelection = (a: Selection | null | undefined, b: Selection | null | undefined) => selectionKey(a) === selectionKey(b);

export interface ConditionRef {
  sourceRef: string;
  citation: string;
  text: string;
  status: ConditionStatus;
  refs: string[];
}

/** Everything in the case that cites one piece of evidence. */
export interface Citers {
  findings: { index: number; text: string; basis: "reported" | "corroborated" }[];
  hypotheses: { index: number; text: string; status: "open" | "supported" | "ruled_out" }[];
  work: { key: string; title: string; status: string }[];
  rationale: string[];
  conditions: ConditionRef[];
}

export function citersOf(ref: string, status: CaseStatus, proposal: CaseProposal | null, analysis: StoredAnalysis | null): Citers {
  const inv = status.investigation;
  const has = (refs: readonly string[]) => refs.includes(ref);
  return {
    findings: inv.findings.flatMap((f, index) => (has(f.refs) ? [{ index, text: f.text, basis: f.basis }] : [])),
    hypotheses: inv.hypotheses.flatMap((h, index) => (has(h.refs) ? [{ index, text: h.text, status: h.status }] : [])),
    work: inv.workItems.filter((w) => has(w.refs)).map((w) => ({ key: w.key, title: w.status === "done" ? (w.doneTitle ?? w.title) : w.title, status: w.status })),
    rationale: proposal?.rationale.filter((r) => has(r.refs)).map((r) => r.point) ?? [],
    conditions: conditionsCiting(analysis, (refs) => has(refs)),
  };
}

function conditionsCiting(analysis: StoredAnalysis | null, test: (refs: string[]) => boolean): ConditionRef[] {
  return (analysis?.considerations ?? []).flatMap((c) =>
    c.conditions.filter((k) => test(k.refs)).map((k) => ({ sourceRef: c.sourceRef, citation: getSource(c.sourceRef)?.citation ?? c.sourceRef, text: k.text, status: k.status, refs: k.refs })),
  );
}

/** Conditions (from the rule-based considerations) that cite any of the given refs: how a finding touches the framework. */
export function conditionsFor(analysis: StoredAnalysis | null, refs: readonly string[]): ConditionRef[] {
  const set = new Set(refs);
  return conditionsCiting(analysis, (rs) => rs.some((r) => set.has(r)));
}

export type EvidenceDetail =
  | { kind: "statement"; ref: string; statement: ViewStatement; superseded: { by: string; fields: string[] } | null }
  | { kind: "transaction"; ref: string; transaction: ViewTransaction; reconciliation: Reconciliation; origin: CaseView["paymentOrigins"][number] | null; excludedReason: string | null }
  | { kind: "provider"; ref: string; row: CaseView["providerEvidence"][number] }
  | { kind: "regulatory"; ref: string; source: RegulatorySource | null }
  | { kind: "missing"; ref: string; evidenceKind: EvidenceKind | null; superseded: boolean };

/** What a ref points at in this case, or "missing" when the case holds no such record (never invented). */
export function evidenceDetail(view: CaseView, analysis: StoredAnalysis | null, ref: string): EvidenceDetail {
  const kind = evidenceKindOf(ref);
  if (kind === "statement") {
    const s = view.statements.find((x) => x.ref === ref);
    if (s) return { kind: "statement", ref, statement: s, superseded: analysis?.facts.superseded.find((x) => x.ref === ref) ?? null };
  } else if (kind === "transaction") {
    const t = view.transactions.find((x) => x.ref === ref);
    if (t) {
      const r = reconciliation(analysis, ref).state;
      return {
        kind: "transaction",
        ref,
        transaction: t,
        reconciliation: r,
        origin: view.paymentOrigins.find((o) => o.txnRef === ref) ?? null,
        excludedReason: analysis?.match.excluded.find((x) => x.txnRef === ref)?.reason ?? null,
      };
    }
    if (view.history.transactions.some((x) => x.ref === ref)) return { kind: "missing", ref, evidenceKind: kind, superseded: true };
  } else if (kind === "provider") {
    const row = view.providerEvidence.find((x) => x.ref === ref);
    if (row) return { kind: "provider", ref, row };
    if (view.history.providerEvidence.some((x) => x.ref === ref)) return { kind: "missing", ref, evidenceKind: kind, superseded: true };
  } else if (kind === "regulatory") {
    return { kind: "regulatory", ref, source: getSource(ref) ?? null };
  }
  return { kind: "missing", ref, evidenceKind: kind, superseded: false };
}

export interface RuleDetail {
  ref: string;
  source: RegulatorySource | null;
  /** The model's reading of this source for this case, if it gave one. */
  reading: CaseProposal["legalBasis"][number] | null;
  /** The rule-based guardrail's view: why it flagged the source and the status of each condition. */
  consideration: { relevance: string; conditions: { text: string; status: ConditionStatus; refs: string[] }[]; reviewSteps: string[] } | null;
}

export function ruleDetail(analysis: StoredAnalysis | null, proposal: CaseProposal | null, ref: string): RuleDetail {
  const c = analysis?.considerations.find((x) => x.sourceRef === ref);
  return {
    ref,
    source: getSource(ref) ?? null,
    reading: proposal?.legalBasis.find((l) => l.sourceRef === ref) ?? null,
    consideration: c ? { relevance: c.relevance, conditions: c.conditions.map((k) => ({ text: k.text, status: k.status, refs: k.refs })), reviewSteps: c.reviewSteps } : null,
  };
}

/** The sources in play for this case: the model's readings first, then any the guardrail flagged that the model didn't read. */
export function frameworkSources(analysis: StoredAnalysis | null, proposal: CaseProposal | null): { ref: string; from: "model" | "rules"; reading: RuleDetail["reading"]; relevance: string | null }[] {
  const out: { ref: string; from: "model" | "rules"; reading: RuleDetail["reading"]; relevance: string | null }[] = [];
  const seen = new Set<string>();
  for (const l of proposal?.legalBasis ?? []) {
    if (seen.has(l.sourceRef)) continue;
    seen.add(l.sourceRef);
    out.push({ ref: l.sourceRef, from: "model", reading: l, relevance: analysis?.considerations.find((c) => c.sourceRef === l.sourceRef)?.relevance ?? null });
  }
  for (const c of analysis?.considerations ?? []) {
    if (seen.has(c.sourceRef)) continue;
    seen.add(c.sourceRef);
    out.push({ ref: c.sourceRef, from: "rules", reading: null, relevance: c.relevance });
  }
  return out;
}

export interface PolicySummary {
  policy: string;
  eligible: boolean;
  passed: number;
  total: number;
  checks: { id: string; label: string; passed: boolean; detail: string }[];
}

export function policySummary(auto: AutoApprovalEvaluation | null | undefined): PolicySummary | null {
  if (!auto) return null;
  const checks = auto.checks.map((c) => ({ id: c.id, label: checkLabel(c.id), passed: c.passed, detail: c.detail }));
  return { policy: auto.policy, eligible: auto.eligible, passed: checks.filter((c) => c.passed).length, total: checks.length, checks };
}

export function registryRuleText(id: string): { id: string; rule: string; claimType: string; obligation: string; humanReview: string } | null {
  const r = getRegistryRule(id);
  return r ? { id, rule: r.rule, claimType: r.claim_type, obligation: r.obligation, humanReview: r.human_review_trigger } : null;
}

/** Short, reviewer-language description of a transaction. */
export const describeTransaction = (t: Pick<ViewTransaction, "amount" | "merchantName" | "description" | "date">) =>
  `$${t.amount.toFixed(2)}${t.merchantName ?? t.description ? ` · ${t.merchantName ?? t.description}` : ""}${t.date ? ` · ${t.date}` : ""}`;
