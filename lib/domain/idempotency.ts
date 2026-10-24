/**
 * Idempotency keys for retried events. Uses Web Crypto (available in browsers, Node, and
 * the Convex runtime).
 */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Identifies one voice utterance: by its turn id when the platform provides one, otherwise by
 * the normalized text (a retried tool call repeats the same text).
 */
export async function voiceUtteranceKey(utterance: string, turnId?: string): Promise<string> {
  const basis = turnId ? `turn:${turnId}` : `text:${utterance.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return (await sha256Hex(basis)).slice(0, 32);
}

/**
 * The full key also names the question the utterance answers. A retried tool call (same
 * question, same words) is a duplicate; "Yes." said to two different questions is not.
 */
export function voiceIdempotencyKey(sessionRef: string, askedTurnId: string | null, utteranceKey: string): string {
  return `voice:${sessionRef}:${askedTurnId ?? "start"}:${utteranceKey}`;
}
