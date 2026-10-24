/**
 * Chooses what the voice agent asks next. The backend owns the question; the agent only words it.
 */
import type { OpenQuestion } from "./schemas";

/** A question asked this many times in one call without being settled is handed to a reviewer. */
export const MAX_ASKS_PER_CALL = 2;

export const AWAITING_PROMPT = "Thank you. Is there anything else about that you'd like to add?";

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
