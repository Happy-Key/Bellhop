/**
 * Pure view models for the case workspace: reconciliation state, findings grouped by support, the
 * decision trace behind the draft route, and which prepared outputs exist. They only re-read the
 * stored analysis; nothing here decides a claim.
 */
import type { Finding, SourceCategory } from "../domain/schemas";
import { getSource, type ConditionStatus, type SourceKind } from "../domain/regulatory";
import type { StoredAnalysis } from "../domain/triage";
import type { CaseView } from "./types";

export type Kind = "reported" | "observed" | "inferred";

export const CATEGORY_KIND: Record<SourceCategory, Kind> = {
  customer_statement: "reported",
  transaction_record: "observed",
  external_provider: "observed",
  rule_based_inference: "inferred",
  model_inference: "inferred",
};

// ---------- Reconciliation ----------

export type Reconciliation = "confirmed" | "matched" | "tentative" | "candidate" | "excluded" | "unrelated";

export const RECONCILIATION_LABEL: Record<Reconciliation, string> = {
  confirmed: "Customer-confirmed match",
  matched: "Matched by rules",
  tentative: "Tentative match",
  candidate: "Candidate (unresolved)",
  excluded: "Excluded by rules",
  unrelated: "Not a candidate",
};

/** How a bank record stands against the customer's account, as the matcher left it. */
export function reconciliation(analysis: StoredAnalysis | null, ref: string): { state: Reconciliation; confirmedBy?: string } {
  const m = analysis?.match;
  if (!m) return { state: "unrelated" };
  if (m.matchedRef === ref) {
    const by = m.candidates[0]?.reasons.find((r) => r.field === "customer_confirmation")?.statementRef;
    return by ? { state: "confirmed", confirmedBy: by } : { state: "matched" };
  }
  if (m.candidates.some((c) => c.txnRef === ref)) return { state: m.outcome === "tentative" ? "tentative" : "candidate" };
  if (m.excluded.some((x) => x.txnRef === ref)) return { state: "excluded" };
  return { state: "unrelated" };
}

// ---------- Findings and open questions ----------

export interface FindingItem {
  id: string;
  kind: Kind;
  text: string;
  refs: string[];
  status?: Finding["status"];
  detail?: string;
  audience?: "customer" | "reviewer";
  blocking?: boolean;
}

export interface FindingGroups {
  supported: FindingItem[];
  missing: FindingItem[];
  conflicting: FindingItem[];
  superseded: FindingItem[];
  rejectedCount: number;
}

const uniq = (refs: string[]) => [...new Set(refs.filter((r) => !r.startsWith("R:")))];

export function groupFindings(view: CaseView, analysis: StoredAnalysis | null): FindingGroups {
  const groups: FindingGroups = { supported: [], missing: [], conflicting: [], superseded: [], rejectedCount: analysis?.rejectedFindings.length ?? 0 };
  const corrections = analysis?.facts.superseded ?? [];
  const isCorrectionNote = (f: Finding) => f.category === "customer_statement" && corrections.some((c) => f.evidenceRefs.length === 2 && f.evidenceRefs[0] === c.ref && f.evidenceRefs[1] === c.by);

  for (const f of analysis?.findings ?? []) {
    if (isCorrectionNote(f)) continue;
    const item: FindingItem = { id: f.id, kind: CATEGORY_KIND[f.category], text: f.text, refs: uniq(f.evidenceRefs), status: f.status };
    if (f.status === "disputed") groups.conflicting.push({ ...item, detail: f.contradictions.join(" · ") });
    else groups.supported.push(item);
  }
  // A candidate the matcher kept despite a contradiction (e.g. an approximate amount).
  for (const c of analysis?.match.candidates ?? []) {
    for (const x of c.contradictions) groups.conflicting.push({ id: `m-${c.txnRef}-${x}`, kind: "inferred", text: `Matcher: ${x}.`, refs: [c.txnRef] });
  }

  const bf = view.case.bankFetch;
  if (view.statements.length > 0 && bf.status === "never") groups.missing.push({ id: "records", kind: "observed", text: "Bank records have not been retrieved.", refs: [] });
  for (const ref of analysis?.facts.uninterpretedRefs ?? []) groups.missing.push({ id: `u-${ref}`, kind: "inferred", text: `${ref} has not been interpreted yet, so its facts are missing from the analysis.`, refs: [ref] });
  for (const q of analysis?.questions ?? []) {
    // Analyses stored before stable keys existed have none; fall back to the display ID.
    groups.missing.push({ id: q.key || q.id, kind: q.audience === "customer" ? "reported" : "inferred", text: q.text, refs: uniq(q.relatedRefs), audience: q.audience, blocking: q.blocking });
  }

  for (const c of corrections) groups.superseded.push({ id: `c-${c.ref}`, kind: "reported", text: `${c.ref} was corrected by ${c.by} (${c.fields.join(", ")}). The original statement is kept unchanged.`, refs: [c.ref, c.by] });
  for (const t of view.history.transactions) groups.superseded.push({ id: `h-${t._id}`, kind: "observed", text: `Earlier version of ${t.ref}: $${t.amount.toFixed(2)}, status ${t.status ?? "unknown"}. Replaced by a newer retrieval.`, refs: [t.ref] });
  for (const p of view.history.providerEvidence) groups.superseded.push({ id: `hp-${p._id}`, kind: "observed", text: `Earlier ${p.provider} value for ${p.field}: ${p.value}${p.supersededReason ? ` (${p.supersededReason})` : ""}.`, refs: [] });
  return groups;
}

// ---------- Decision trace ----------

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  regulation: "Regulation text",
  official_interpretation: "Official interpretation",
  agency_guidance: "Agency guidance (non-binding)",
  institution_policy: "Institution policy",
};

export interface TraceSource {
  ref: string;
  citation: string;
  kind: SourceKind;
  relevance: string;
  url: string | null;
  synthetic: boolean;
  verbatimVerified: boolean;
  conditions: { text: string; status: ConditionStatus; refs: string[] }[];
}

export interface DecisionTrace {
  factsUsed: FindingItem[];
  sources: TraceSource[];
  unresolved: { text: string; refs: string[] }[];
  blocking: { key: string; text: string; audience: "customer" | "reviewer" }[];
}

/** Assumptions the rules actually make. Stated, not inferred per case. */
export const RULE_ASSUMPTIONS = [
  "Customer statements are treated as reported and unverified; they are never promoted to fact.",
  "One disputed payment per case. Per-payment routes are not built yet.",
  "Considerations are curated sources picked by fixed rules. Whether any applies is for a person to decide.",
];

export function decisionTrace(view: CaseView, analysis: StoredAnalysis): DecisionTrace {
  const groups = groupFindings(view, analysis);
  const sources: TraceSource[] = analysis.considerations.map((c) => {
    const src = getSource(c.sourceRef);
    return {
      ref: c.sourceRef,
      citation: src?.citation ?? c.sourceRef,
      kind: src?.kind ?? "regulation",
      relevance: c.relevance,
      url: src?.url.startsWith("http") ? src.url : null,
      synthetic: src?.kind === "institution_policy",
      verbatimVerified: src?.verbatimVerified ?? false,
      conditions: c.conditions.map((k) => ({ text: k.text, status: k.status, refs: uniq(k.refs) })),
    };
  });
  const seen = new Set<string>();
  const unresolved = sources.flatMap((s) => s.conditions).filter((k) => k.status === "unresolved" && !seen.has(k.text) && seen.add(k.text));
  const byId = new Map(analysis.questions.map((q) => [q.id, q]));
  // Reported signals the rules read but that have no finding of their own.
  const f = analysis.facts;
  const signals: FindingItem[] = [
    ...(f.credentialSharing ? [{ id: "sig-credentials", kind: "reported" as const, text: `Customer says ${f.credentialSharing.value === "shared" ? "codes or details were shared" : f.credentialSharing.value === "not_shared" ? "nothing was shared" : "nothing about sharing"}.`, refs: [f.credentialSharing.statementRef] }] : []),
    ...f.scamIndicators.map((x, i) => ({ id: `sig-scam-${i}`, kind: "reported" as const, text: `Customer mentions “${x.value}” (read as a scam sign by the rules).`, refs: [x.statementRef] })),
  ];
  return {
    factsUsed: [...groups.supported, ...signals],
    sources,
    unresolved: unresolved.map((k) => ({ text: k.text, refs: k.refs })),
    blocking: analysis.recommendation.blockingQuestionIds.flatMap((id) => {
      const q = byId.get(id);
      return q ? [{ key: q.key || q.id, text: q.text, audience: q.audience }] : [];
    }),
  };
}

// ---------- Prepared outputs ----------

export type OutputState = "ready_for_review" | "draft_prepared" | "blocked" | "not_yet_applicable" | "no_template";

export const OUTPUT_STATE_LABEL: Record<OutputState, string> = {
  ready_for_review: "Ready for review",
  draft_prepared: "Draft prepared",
  blocked: "Blocked by missing information",
  not_yet_applicable: "Not yet applicable",
  no_template: "No approved template",
};

export interface PreparedOutput {
  id: "investigation_summary" | "information_request" | "acknowledgment" | "resolution" | "closure";
  title: string;
  audience: "Internal" | "Customer";
  state: OutputState;
  reason: string;
  /** Content assembled in the browser from stored data, not by the backend. Labelled as a preview. */
  preview: boolean;
  body: string[];
}

export function preparedOutputs(analysis: StoredAnalysis | null): PreparedOutput[] {
  const customerQs = analysis?.questions.filter((q) => q.audience === "customer") ?? [];
  const blocking = analysis?.questions.filter((q) => q.blocking) ?? [];
  const summary: PreparedOutput = !analysis
    ? { id: "investigation_summary", title: "Investigation summary", audience: "Internal", state: "not_yet_applicable", reason: "No analysis yet.", preview: false, body: [] }
    : {
        id: "investigation_summary",
        title: "Investigation summary",
        audience: "Internal",
        state: analysis.packet.readyForHumanReview ? "ready_for_review" : blocking.length ? "blocked" : "draft_prepared",
        reason: analysis.packet.readyForHumanReview
          ? "The backend's draft packet has no blocking questions."
          : blocking.length
            ? `${blocking.length} blocking question${blocking.length === 1 ? "" : "s"} open.`
            : "Draft packet prepared; not yet at human review.",
        preview: false,
        body: [...analysis.packet.summary, analysis.packet.notice],
      };
  return [
    summary,
    customerQs.length
      ? {
          id: "information_request",
          title: "Information request",
          audience: "Customer",
          state: "draft_prepared",
          reason: "Assembled from the open customer questions. No approved template; it can't be sent from here.",
          preview: true,
          body: customerQs.map((q) => q.text),
        }
      : { id: "information_request", title: "Information request", audience: "Customer", state: "not_yet_applicable", reason: "No open customer questions.", preview: false, body: [] },
    { id: "acknowledgment", title: "Acknowledgment", audience: "Customer", state: "no_template", reason: "No approved acknowledgment template exists in this prototype, so none is drafted.", preview: false, body: [] },
    { id: "resolution", title: "Resolution communication", audience: "Customer", state: "not_yet_applicable", reason: "Needs a human decision on the claim. This prototype records none.", preview: false, body: [] },
    { id: "closure", title: "Closure record", audience: "Internal", state: "not_yet_applicable", reason: "A case closes only by a person's action, which isn't built yet.", preview: false, body: [] },
  ];
}
