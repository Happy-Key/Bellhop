/**
 * Investigation timeline: statements, bank records, record versions, rule readings and recorded
 * actions merged into one list. Pure view model; every time shown is a stored time. Bank records
 * carry a date only, so they keep a date and are never given a time of day.
 */
import type { CaseView, DemoReviewEvent } from "./types";

/** Reported: the customer said it. Observed: a record shows it. Inferred: rules read it. Action: something was done. */
export type EventClass = "reported" | "observed" | "inferred" | "action";

export interface TimelineEvent {
  id: string;
  /** Sort key (ms). For date-only records this is noon UTC of that date, used for ordering only. */
  sortAt: number;
  /** Exact time of the event, when stored. */
  at: number | null;
  /** Date-only events (bank record dates). */
  date: string | null;
  /** When the system recorded it, if different from the event time. */
  recordedAt: number | null;
  cls: EventClass;
  problem: boolean;
  label: string;
  source: string;
  text: string;
  refs: string[];
  /** Statement events: the question the reply answered. */
  question?: string;
  correctsRef?: string;
  paymentRef?: string;
  demoOnly?: boolean;
}

const REF = /\b(?:S\d+|T:[A-Za-z0-9_-]+|X:[A-Za-z0-9_.:-]+)\b/g;

const ACTIVITY: Record<string, { cls: EventClass; label: string; problem?: boolean } | null> = {
  // Repeat the statement events.
  statement_recorded: null,
  interpreted: null,
  case_created: { cls: "action", label: "Case opened" },
  account_bound: { cls: "action", label: "Account bound" },
  bank_records_retrieved: { cls: "action", label: "Evidence update" },
  identity_evidence_retrieved: { cls: "action", label: "Evidence update" },
  voice_session_created: { cls: "action", label: "Call" },
  voice_call_bound: { cls: "action", label: "Call" },
  sensitive_removed: { cls: "action", label: "Redaction" },
  question_handed_to_reviewer: { cls: "action", label: "Handed to reviewer" },
  answer_read: { cls: "inferred", label: "Reply read" },
  interpretation_requested: { cls: "inferred", label: "Interpretation" },
  interpretation_retry: { cls: "inferred", label: "Interpretation" },
  awaiting_interpretation: { cls: "inferred", label: "Interpretation pending" },
  stale_result_discarded: { cls: "inferred", label: "Interpretation", problem: true },
  findings_rejected: { cls: "inferred", label: "Findings rejected", problem: true },
  integration_error: { cls: "action", label: "Integration error", problem: true },
  warning: { cls: "action", label: "Warning", problem: true },
};

export const REVIEW_ACTION_LABEL: Record<DemoReviewEvent["action"], string> = {
  accept: "Accepted proposed next step",
  request_info: "Requested more information",
  return: "Returned for additional investigation",
  escalate: "Escalated for review",
  override: "Recorded an override",
};

const noonUtc = (date: string) => Date.parse(`${date}T12:00:00Z`);

export function buildTimeline(view: CaseView, opts: { recordSource: string; reviewEvents?: DemoReviewEvent[] }): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const s of view.statements) {
    events.push({
      id: `s-${s._id}`,
      sortAt: s.receivedAt,
      at: s.receivedAt,
      date: null,
      recordedAt: null,
      cls: "reported",
      problem: s.interpretationStatus === "failed",
      label: s.correctsRef ? "Correction" : s.inResponseTo ? "Answer" : "Statement",
      source: `Customer · ${s.channel}`,
      text: s.text,
      refs: [s.ref],
      ...(s.inResponseTo ? { question: s.inResponseTo.text } : {}),
      ...(s.correctsRef ? { correctsRef: s.correctsRef } : {}),
    });
  }
  const records = [...view.transactions.map((t) => ({ t, superseded: false })), ...view.history.transactions.map((t) => ({ t, superseded: true }))];
  for (const { t, superseded } of records) {
    if (t.date && !superseded) {
      events.push({
        id: `t-${t._id}`,
        sortAt: noonUtc(t.date),
        at: null,
        date: t.date,
        recordedAt: t.retrievedAt,
        cls: "observed",
        problem: false,
        label: "Bank record",
        source: opts.recordSource,
        text: `$${t.amount.toFixed(2)} ${t.kind} · ${t.merchantName ?? t.description ?? "unknown payee"} · status ${t.status ?? "unknown"}`,
        refs: [t.ref],
        paymentRef: t.ref,
      });
    }
    if (superseded && t.supersededAt) {
      events.push({
        id: `h-${t._id}`,
        sortAt: t.supersededAt,
        at: t.supersededAt,
        date: null,
        recordedAt: null,
        cls: "observed",
        problem: false,
        label: "Record version superseded",
        source: opts.recordSource,
        text: `An earlier version of this record ($${t.amount.toFixed(2)}, status ${t.status ?? "unknown"}) was replaced by a newer retrieval. The earlier version is kept.`,
        refs: [t.ref],
        paymentRef: t.ref,
      });
    }
  }
  for (const a of view.activity) {
    const m = ACTIVITY[a.kind];
    if (m === null) continue;
    events.push({
      id: `a-${a._id}`,
      sortAt: a.at,
      at: a.at,
      date: null,
      recordedAt: null,
      cls: m?.cls ?? "action",
      problem: m?.problem ?? false,
      label: m?.label ?? "System",
      source: a.actor,
      text: a.message,
      refs: [...new Set(a.message.match(REF) ?? [])],
    });
  }
  for (const r of opts.reviewEvents ?? []) {
    events.push({
      id: `r-${r.id}`,
      sortAt: r.at,
      at: r.at,
      date: null,
      recordedAt: null,
      cls: "action",
      problem: false,
      label: "Reviewer",
      source: "Reviewer",
      text: `${REVIEW_ACTION_LABEL[r.action]}${r.reason ? `: ${r.reason}` : "."}`,
      refs: [],
      demoOnly: true,
    });
  }
  return events.sort((a, b) => a.sortAt - b.sortAt);
}
