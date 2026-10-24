/**
 * Idempotency keys for retried events. Uses Web Crypto (available in browsers, Node, and
 * the Convex runtime).
 */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A voice tool call is identified by its turn id when the platform provides one; otherwise
 * by the normalized utterance text within the session (a retried call repeats the same text).
 */
export async function voiceIdempotencyKey(sessionToken: string, utterance: string, turnId?: string): Promise<string> {
  const basis = turnId ? `turn:${turnId}` : `text:${utterance.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `voice:${sessionToken}:${(await sha256Hex(basis)).slice(0, 32)}`;
}
