/**
 * "How the intake progressed": each customer reply paired with the question it answered, what the
 * rules read from it, and the question the backend issued next. Pure view model over stored data.
 *
 * Only submitted replies are stored (not a full transcript), and a question is known only through
 * the reply that answered it (`inResponseTo`). The next question is read from the stored analysis
 * and is never shown while an interpretation is pending, because that reply may already answer it.
 */
import type { AnswerState, OpenQuestion } from "../domain/schemas";
import { QUESTION_WHY, type StoredAnalysis } from "../domain/triage";
import { relatedRefFromKey } from "../domain/answers";
import { selectVoiceQuestion } from "../domain/voiceTurn";
import type { ViewStatement } from "./types";

export type EstablishedField = "confirms" | "rejects" | "position" | "credentials" | "amount" | "date" | "payee" | "scam_sign";

export interface Established {
  field: EstablishedField;
  value: string;
  /** reply_parser: read from a short reply using its question. extractor: read from the words alone. */
  via: "reply_parser" | "extractor";
}

export interface IntakeQuestion {
  key: string;
  kind: string;
  text: string;
  why: string | null;
  refs: string[];
}

export interface IntakeTurn {
  ref: string;
  /** The question this reply answered, or null for an opening account / unprompted statement. */
  asked: IntakeQuestion | null;
  reply: Pick<ViewStatement, "text" | "channel" | "receivedAt" | "correctsRef" | "redactions">;
  /** How the reply settled its question; "opening" when it answered no recorded question. */
  state: AnswerState | "opening";
  interpretation: ViewStatement["interpretationStatus"];
  interpretationError?: string;
  established: Established[];
  /** Who read facts from the words: the scripted extractor or a live model (null when not interpreted). */
  reader: { mode: "scripted" | "live"; provider: string } | null;
}

export type IntakeNext =
  | { status: "awaiting_report" }
  | { status: "awaiting_interpretation"; refs: string[] }
  | { status: "question"; question: IntakeQuestion }
  | { status: "reviewer_only"; count: number }
  | { status: "complete" };

export interface IntakeProgress {
  turns: IntakeTurn[];
  next: IntakeNext;
  /** Questions still open now, all audiences, in the analysis's priority order. */
  open: OpenQuestion[];
}

const toQuestion = (q: { key: string; kind: string; text: string }, refs: string[] = []): IntakeQuestion => ({
  key: q.key,
  kind: q.kind,
  text: q.text,
  why: QUESTION_WHY[q.kind as OpenQuestion["kind"]] ?? null,
  refs: [...new Set([...(relatedRefFromKey(q.key) ? [relatedRefFromKey(q.key)!] : []), ...refs])],
});

function established(s: ViewStatement): Established[] {
  const out: Established[] = [];
  const d = s.answer?.derived;
  if (d?.confirmsTxnRef) out.push({ field: "confirms", value: d.confirmsTxnRef, via: "reply_parser" });
  if (d?.rejectsTxnRef) out.push({ field: "rejects", value: d.rejectsTxnRef, via: "reply_parser" });
  if (d?.authorization) out.push({ field: "position", value: d.authorization, via: "reply_parser" });
  if (d?.credentialSharing) out.push({ field: "credentials", value: d.credentialSharing, via: "reply_parser" });
  const i = s.interpretation;
  if (!i) return out;
  const has = (f: EstablishedField) => out.some((e) => e.field === f);
  for (const a of i.amounts) out.push({ field: "amount", value: String(a), via: "extractor" });
  for (const dt of i.dates) out.push({ field: "date", value: dt, via: "extractor" });
  for (const m of i.merchantTerms) out.push({ field: "payee", value: m, via: "extractor" });
  if (i.authorization !== "unspecified" && !has("position")) out.push({ field: "position", value: i.authorization, via: "extractor" });
  if (i.credentialSharing !== "unspecified" && !has("credentials")) out.push({ field: "credentials", value: i.credentialSharing, via: "extractor" });
  for (const x of i.scamIndicators) out.push({ field: "scam_sign", value: x, via: "extractor" });
  return out;
}

export function intakeProgress(statements: ViewStatement[], analysis: StoredAnalysis | null): IntakeProgress {
  const ordered = [...statements].sort((a, b) => a.receivedAt - b.receivedAt);
  const turns: IntakeTurn[] = ordered.map((s) => {
    return {
      ref: s.ref,
      asked: s.inResponseTo ? toQuestion(s.inResponseTo) : null,
      reply: { text: s.text, channel: s.channel, receivedAt: s.receivedAt, correctsRef: s.correctsRef, redactions: s.redactions },
      state: s.answer?.state ?? "opening",
      interpretation: s.interpretationStatus,
      ...(s.interpretationError ? { interpretationError: s.interpretationError } : {}),
      established: established(s),
      reader: s.interpretation ? { mode: s.interpretation.mode, provider: s.interpretation.provider } : null,
    };
  });

  const open = analysis?.questions ?? [];
  let next: IntakeNext;
  const pending = ordered.filter((s) => s.interpretationStatus === "pending").map((s) => s.ref);
  if (ordered.length === 0) next = { status: "awaiting_report" };
  else if (pending.length > 0) next = { status: "awaiting_interpretation", refs: pending };
  else {
    // The same selection the voice webhook uses. Per-call repeat counts aren't part of the case
    // view, so a question already asked twice on a call may show here; the backend won't ask it.
    const q = selectVoiceQuestion(open, new Map()).question;
    const reviewer = open.filter((x) => x.audience === "reviewer").length;
    next = q ? { status: "question", question: toQuestion(q, q.relatedRefs) } : reviewer > 0 ? { status: "reviewer_only", count: reviewer } : { status: "complete" };
  }
  return { turns, next, open };
}
