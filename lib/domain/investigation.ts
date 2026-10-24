/**
 * The case investigation: the reasoning model's evolving assessment of one case.
 *
 * The model decides the substance (what is established, what is uncertain, which investigative
 * work matters for THIS case, and what to do next). This module is the deterministic control
 * around it: output shape, evidence provenance, ref checks, and a recorded diff between versions,
 * so a revised assessment never silently replaces an earlier one.
 *
 * Four things are kept apart everywhere they are shown:
 *  - a hypothesis   (a working interpretation the model is testing),
 *  - a finding      (a fact with cited evidence; "reported" = the customer's word only,
 *                    "corroborated" = backed by a bank record or provider fact),
 *  - a proposed disposition (the model's decision; see caseDecision.ts),
 *  - an authorized outcome  (a person's, or policy AUTO-1's, recorded decision).
 *
 * When live reasoning is off, ruleBasedInvestigation() derives the same shape from the rule-based
 * analysis. It is always labelled as the rule-based fallback, never as the model's work.
 */
import { z } from "zod";
import { evidenceKindOf } from "./schemas";
import type { CaseAnalysis } from "./workflow";

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const refs = z.array(z.string()).max(10);

export const WORK_STATUSES = ["in_progress", "awaiting_customer", "awaiting_bank", "done", "not_needed"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const InvestigationOutput = z.object({
  /** What is established, each with its evidence. */
  findings: z.array(z.object({ text: text(300).pipe(z.string().min(1)), basis: z.enum(["reported", "corroborated"]), refs })).max(8),
  /** Working interpretations being tested. Not findings. */
  hypotheses: z.array(z.object({ text: text(200).pipe(z.string().min(1)), status: z.enum(["open", "supported", "ruled_out"]), refs })).max(5),
  /** Material uncertainties. `blocking` = no disposition can be proposed until it is settled. */
  uncertainties: z.array(z.object({ text: text(300).pipe(z.string().min(1)), blocking: z.boolean() })).max(6),
  /** Meaningful investigative work for this case, chosen by the model. Keys stay stable across revisions. */
  workItems: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,40}$/),
        title: text(80).pipe(z.string().min(1)),
        doneTitle: text(80).nullable(),
        detail: text(240),
        status: z.enum(WORK_STATUSES),
        outcome: text(240).nullable(),
        refs,
      }),
    )
    .max(6),
  /** Why the assessment changed since the previous version, if it did. */
  changes: z.array(z.object({ text: text(300).pipe(z.string().min(1)), refs })).max(5),
});
export type Investigation = z.infer<typeof InvestigationOutput>;
export type WorkItem = Investigation["workItems"][number];

export const EMPTY_INVESTIGATION: Investigation = { findings: [], hypotheses: [], uncertainties: [], workItems: [], changes: [] };

/**
 * Checks an investigation against the evidence the model was allowed to cite. Items citing
 * unknown evidence are dropped; a "corroborated" finding with no bank record or provider fact is
 * downgraded to "reported". Every adjustment is listed, never applied silently.
 */
export function validateInvestigation(inv: Investigation, citableRefs: readonly string[]): { investigation: Investigation; problems: string[] } {
  const known = new Set(citableRefs);
  const problems: string[] = [];
  const keep = <T extends { refs: string[] }>(items: T[], what: string, label: (x: T) => string): T[] =>
    items.filter((x) => {
      const bad = x.refs.filter((r) => !known.has(r));
      if (bad.length) problems.push(`dropped ${what} "${label(x).slice(0, 60)}": unknown evidence ${bad.join(", ")}`);
      return bad.length === 0;
    });

  const findings = keep(inv.findings, "finding", (f) => f.text).map((f) => {
    if (f.refs.length === 0) {
      problems.push(`dropped finding "${f.text.slice(0, 60)}": cites no evidence`);
      return null;
    }
    const corroborated = f.refs.some((r) => {
      const k = evidenceKindOf(r);
      return k === "transaction" || k === "provider";
    });
    if (f.basis === "corroborated" && !corroborated) {
      problems.push(`finding "${f.text.slice(0, 60)}" marked corroborated but cites only customer statements or rules; shown as reported`);
      return { ...f, basis: "reported" as const };
    }
    return f;
  });
  const hypotheses = keep(inv.hypotheses, "hypothesis", (h) => h.text).map((h) => {
    if (h.status !== "supported" || h.refs.length > 0) return h;
    problems.push(`hypothesis "${h.text.slice(0, 60)}" marked supported without evidence; shown as open`);
    return { ...h, status: "open" as const };
  });
  const seen = new Set<string>();
  const workItems = keep(inv.workItems, "work item", (w) => w.title).filter((w) => {
    if (seen.has(w.key)) {
      problems.push(`dropped duplicate work item key ${w.key}`);
      return false;
    }
    seen.add(w.key);
    return true;
  });
  const changes = keep(inv.changes, "change note", (c) => c.text);
  return { investigation: { findings: findings.filter((f) => f !== null), hypotheses, uncertainties: inv.uncertainties, workItems, changes }, problems };
}

export interface RecordedChange {
  kind: "work_started" | "work_status" | "work_done" | "work_dropped" | "finding_added" | "finding_removed" | "hypothesis" | "decision";
  text: string;
}

const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  in_progress: "in progress",
  awaiting_customer: "awaiting the customer",
  awaiting_bank: "awaiting the bank",
  done: "done",
  not_needed: "not needed",
};

/**
 * What changed between two versions of the investigation, computed by code (not the model's own
 * account), so the audit history shows every revision.
 */
export function diffInvestigations(
  prev: { investigation: Investigation; decision: string | null } | null,
  next: { investigation: Investigation; decision: string | null },
): RecordedChange[] {
  const out: RecordedChange[] = [];
  const before = new Map((prev?.investigation.workItems ?? []).map((w) => [w.key, w]));
  for (const w of next.investigation.workItems) {
    const old = before.get(w.key);
    if (!old) out.push({ kind: w.status === "done" ? "work_done" : "work_started", text: w.status === "done" ? `${w.doneTitle ?? w.title}${w.outcome ? `: ${w.outcome}` : ""}` : `Started: ${w.title}` });
    else if (old.status !== w.status) {
      out.push(
        w.status === "done"
          ? { kind: "work_done", text: `${w.doneTitle ?? w.title}${w.outcome ? `: ${w.outcome}` : ""}` }
          : w.status === "not_needed"
            ? { kind: "work_dropped", text: `No longer needed: ${w.title}` }
            : { kind: "work_status", text: `${w.title}: ${WORK_STATUS_LABEL[old.status]} → ${WORK_STATUS_LABEL[w.status]}` },
      );
    }
    before.delete(w.key);
  }
  for (const w of before.values()) if (w.status !== "done" && w.status !== "not_needed") out.push({ kind: "work_dropped", text: `Removed from the plan: ${w.title}` });

  const oldFindings = new Set((prev?.investigation.findings ?? []).map((f) => f.text));
  const newFindings = new Set(next.investigation.findings.map((f) => f.text));
  for (const f of next.investigation.findings) if (!oldFindings.has(f.text)) out.push({ kind: "finding_added", text: `Finding: ${f.text}` });
  for (const f of prev?.investigation.findings ?? []) if (!newFindings.has(f.text)) out.push({ kind: "finding_removed", text: `Finding withdrawn: ${f.text}` });

  const oldHyp = new Map((prev?.investigation.hypotheses ?? []).map((h) => [h.text, h.status]));
  for (const h of next.investigation.hypotheses) {
    const was = oldHyp.get(h.text);
    if (was !== h.status && h.status !== "open") out.push({ kind: "hypothesis", text: `${h.status === "supported" ? "Supported" : "Ruled out"}: ${h.text}` });
    else if (was === undefined) out.push({ kind: "hypothesis", text: `Considering: ${h.text}` });
  }
  if ((prev?.decision ?? null) !== next.decision && next.decision) out.push({ kind: "decision", text: `Proposed: ${next.decision.replace(/_/g, " ")}${prev?.decision ? ` (was ${prev.decision.replace(/_/g, " ")})` : ""}` });
  return out;
}

/** Active work first (awaiting someone, then in progress), finished work last. */
export function orderWorkItems(items: readonly WorkItem[]): WorkItem[] {
  const rank: Record<WorkStatus, number> = { awaiting_customer: 0, awaiting_bank: 1, in_progress: 2, done: 3, not_needed: 4 };
  return [...items].sort((a, b) => rank[a.status] - rank[b.status]);
}

const WHO_MADE_IT: Record<string, string> = {
  denies_authorization: "Customer reports someone else made the payment.",
  authorized_induced: "Customer reports they made the payment after being deceived.",
  authorized: "Customer reports they made the payment themselves.",
};
const CREDENTIALS: Record<string, string> = {
  shared: "Customer reports sharing a code, password or card details.",
  not_shared: "Customer reports sharing no codes or card details.",
};

/**
 * Fallback when no model is configured: the same shape, derived from the rule-based analysis.
 * Labelled "rule-based" wherever it is shown. It covers only the work the rules know about.
 */
export function ruleBasedInvestigation(analysis: Pick<CaseAnalysis, "facts" | "match" | "questions">, statementCount: number): Investigation {
  const { facts, match } = analysis;
  const q = (kind: string) => analysis.questions.find((x) => x.kind === kind);
  const work: WorkItem[] = [];
  const item = (w: Omit<WorkItem, "doneTitle" | "outcome" | "refs"> & Partial<Pick<WorkItem, "doneTitle" | "outcome" | "refs">>) =>
    work.push({ doneTitle: null, outcome: null, ...w, refs: [...new Set(w.refs ?? [])] });

  if (statementCount > 0) {
    const pending = q("evidence_unavailable");
    const which = q("ambiguous_match") ?? q("tentative_match") ?? q("no_match") ?? q("missing_transaction_details") ?? q("multiple_amounts");
    item({
      key: "identify_payment",
      title: "Identifying the disputed payment",
      doneTitle: "Disputed payment identified",
      detail: "Comparing the customer's description with the account's records.",
      status: match.matchedRef ? "done" : pending ? "awaiting_bank" : which ? "awaiting_customer" : "in_progress",
      outcome: match.matchedRef ? "Matched to a bank record." : null,
      refs: match.matchedRef ? [match.matchedRef] : [],
    });
  }
  if (facts.conflicts.length) {
    item({ key: "resolve_conflict", title: "Reconciling conflicting statements", detail: `The customer's statements disagree on ${facts.conflicts.map((c) => c.field).join(", ")}.`, status: "awaiting_customer", refs: facts.conflicts.flatMap((c) => c.values.map((v) => v.statementRef)) });
  }
  if (match.matchedRef) {
    item({
      key: "who_initiated",
      title: "Establishing who made the payment",
      doneTitle: "Who made the payment established",
      detail: "Who entered and sent the payment decides which rules apply.",
      status: facts.authorization ? "done" : "awaiting_customer",
      outcome: facts.authorization ? (WHO_MADE_IT[facts.authorization.value] ?? null) : null,
      refs: facts.authorization ? [facts.authorization.statementRef] : [],
    });
  }
  const customerSent = facts.authorization && facts.authorization.value !== "denies_authorization";
  if (customerSent || facts.scamIndicators.length) {
    const open = q("payment_purpose") ?? q("code_purpose");
    item({
      key: "scam_type",
      title: "Assessing scam type",
      doneTitle: "Scam type assessed",
      detail: "Comparing the customer's account with the payment details to choose the handling framework.",
      status: open ? "awaiting_customer" : "done",
      outcome: open ? null : facts.scamIndicators.length ? `Scam signs reported: ${facts.scamIndicators.map((s) => s.value).join(", ")}.` : "No scam signs reported.",
      refs: facts.scamIndicators.map((s) => s.statementRef),
    });
  }
  return {
    findings: [
      ...(match.matchedRef ? [{ text: "The disputed payment matches a bank record.", basis: "corroborated" as const, refs: [...new Set([match.matchedRef, ...facts.txnDecisions.filter((d) => d.txnRef === match.matchedRef).map((d) => d.statementRef)])] }] : []),
      ...(facts.authorization && WHO_MADE_IT[facts.authorization.value] ? [{ text: WHO_MADE_IT[facts.authorization.value]!, basis: "reported" as const, refs: [facts.authorization.statementRef] }] : []),
      ...(facts.credentialSharing && CREDENTIALS[facts.credentialSharing.value] ? [{ text: CREDENTIALS[facts.credentialSharing.value]!, basis: "reported" as const, refs: [facts.credentialSharing.statementRef] }] : []),
    ],
    hypotheses: [],
    uncertainties: analysis.questions.map((x) => ({ text: x.text, blocking: x.blocking })).slice(0, 6),
    workItems: work,
    changes: [],
  };
}
