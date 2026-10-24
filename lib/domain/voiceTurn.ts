/**
 * Chooses what the voice agent asks next. The backend owns the question; the agent only words it.
 */
import type { OpenQuestion } from "./schemas";

/** A question asked this many times in one call without being settled is handed to a reviewer. */
export const MAX_ASKS_PER_CALL = 2;

/**
 * How a call ends. When the backend has nothing left to ask, the customer gets ONE chance to add
 * anything (WRAP_UP), and after their reply the agent says CLOSING and hangs up (`end_call: true`).
 * Live call 2026-10-24: "no" → "anything else?" → "no" looped, because a null question told the
 * agent to ask "anything else?" every time, and the goodbye waited for the customer's goodbye.
 */
export const WRAP_UP_KEY = "wrap_up";
export const WRAP_UP_PROMPT = "Is there anything else you'd like to add about this before we finish?";
/** The wrap-up when nothing was asked on this call: a call-back about a case that already has what it needs (live 2026-10-24). */
export const WRAP_UP_COMPLETE_PROMPT = "Thank you. Your report already has everything we need from you. Is there anything else you'd like to add before we finish?";
export const CLOSING_MESSAGE =
  "Thank you, that's everything I need. Your report is saved, and our fraud team will follow up with you about the outcome. Goodbye.";

export interface VoiceTurnChoice {
  question: OpenQuestion | null;
  /** Questions skipped because they were already asked MAX_ASKS_PER_CALL times this call. */
  exhausted: OpenQuestion[];
}

/** Questions are already in priority order (analyzeCase). Reviewer-only questions are never spoken. */
export function selectVoiceQuestion(questions: OpenQuestion[], askedCounts: ReadonlyMap<string, number>): VoiceTurnChoice {
  const exhausted: OpenQuestion[] = [];
  for (const q of questions) {
    if (q.audience !== "customer") continue;
    if ((askedCounts.get(q.key) ?? 0) >= MAX_ASKS_PER_CALL) {
      exhausted.push(q);
      continue;
    }
    return { question: q, exhausted };
  }
  return { question: null, exhausted };
}
