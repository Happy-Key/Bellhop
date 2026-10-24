/**
 * Validation of findings against known evidence.
 *
 * Every finding (rule-based or model-proposed) passes through here. Findings that cite
 * nonexistent evidence, cite evidence of the wrong kind for their category, or make
 * assertions the cited record does not support are rejected with a reason.
 */
import { Finding, evidenceKindOf, type EvidenceKind, type SourceCategory } from "./schemas";
import type { TransactionEvidence } from "./schemas";
import { merchantMatches } from "./matching";

export interface EvidenceIndex {
  statementRefs: Set<string>;
  transactions: Map<string, TransactionEvidence>;
  providerRefs: Set<string>;
  regulatoryRefs: Set<string>;
}

export interface RejectedFinding {
  finding: unknown;
  reasons: string[];
}

/** Evidence kinds a category must cite at least one of. */
const REQUIRED_KIND: Record<SourceCategory, EvidenceKind[]> = {
  customer_statement: ["statement"],
  transaction_record: ["transaction"],
  external_provider: ["provider"],
  rule_based_inference: ["statement", "transaction", "provider"],
  model_inference: ["statement", "transaction", "provider", "regulatory"],
};

function refExists(index: EvidenceIndex, ref: string): boolean {
  switch (evidenceKindOf(ref)) {
    case "statement": return index.statementRefs.has(ref);
    case "transaction": return index.transactions.has(ref);
    case "provider": return index.providerRefs.has(ref);
    case "regulatory": return index.regulatoryRefs.has(ref);
    default: return false;
  }
}

export function validateFinding(raw: unknown, index: EvidenceIndex): { ok: true; finding: Finding } | { ok: false; reasons: string[] } {
  const parsed = Finding.safeParse(raw);
  if (!parsed.success) return { ok: false, reasons: parsed.error.issues.map((i) => `schema: ${i.path.join(".")} ${i.message}`) };
  const f = parsed.data;
  const reasons: string[] = [];

  for (const ref of f.evidenceRefs) if (!refExists(index, ref)) reasons.push(`unknown evidence reference ${ref}`);

  const kinds = new Set(f.evidenceRefs.map(evidenceKindOf));
  if (!REQUIRED_KIND[f.category].some((k) => kinds.has(k))) {
    reasons.push(`category ${f.category} must cite at least one ${REQUIRED_KIND[f.category].join("/")} reference`);
  }
  if (f.category === "customer_statement" && f.status === "established") {
    reasons.push("customer statements cannot be marked established; they are reported, not verified");
  }
  if (f.category === "model_inference" && f.status === "established") {
    reasons.push("model inferences cannot be marked established");
  }

  for (const a of f.assertions ?? []) {
    if (!f.evidenceRefs.includes(a.ref)) {
      reasons.push(`assertion references ${a.ref} which the finding does not cite`);
      continue;
    }
    const t = index.transactions.get(a.ref);
    if (!t) {
      reasons.push(`assertion on ${a.ref} cannot be checked (only transaction assertions are verifiable)`);
      continue;
    }
    if (a.field === "amount" && !(typeof a.value === "number" && Math.abs(a.value - t.amount) < 0.005)) {
      reasons.push(`record ${a.ref} amount is ${t.amount}, not ${String(a.value)}`);
    }
    if (a.field === "date" && a.value !== t.date) reasons.push(`record ${a.ref} date is ${t.date ?? "unknown"}, not ${String(a.value)}`);
    if (a.field === "merchant" && !merchantMatches(String(a.value), t.merchantName, t.description)) {
      reasons.push(`record ${a.ref} merchant is ${t.merchantName ?? "unknown"}, not ${String(a.value)}`);
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true, finding: f };
}

export function partitionFindings(raws: unknown[], index: EvidenceIndex): { accepted: Finding[]; rejected: RejectedFinding[] } {
  const accepted: Finding[] = [];
  const rejected: RejectedFinding[] = [];
  for (const r of raws) {
    const v = validateFinding(r, index);
    if (v.ok) accepted.push(v.finding);
    else rejected.push({ finding: r, reasons: v.reasons });
  }
  return { accepted, rejected };
}
