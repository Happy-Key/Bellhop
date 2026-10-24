/**
 * Voice channel (Cartesia). Voice utterances enter the SAME recordStatement path as text.
 *
 * Architecture (docs/architecture.md#voice):
 *  - Browser asks Convex for a short-lived Cartesia access token (permanent key stays server-side).
 *  - A Cartesia Managed Agent handles the call. Its webhook tool POSTs finalized utterances
 *    to the Convex HTTP endpoint /voice/tools/record-statement (convex/http.ts).
 *  - The case is identified by a backend-issued voice session, never by the model. For browser
 *    calls the browser binds Cartesia's call ID to the session (bindVoiceCall) and the tool sends
 *    that call ID; browser access tokens cannot supply dynamic variables (verified live
 *    2026-10-24: `dynamic_variables_not_allowed`).
 */
import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import { logActivity, recordStatement } from "./model";
import { redact } from "../lib/providers/errors";
import { CARTESIA_VERSION } from "../lib/providers/cartesia";

export { CARTESIA_VERSION };
export const VOICE_SESSION_TTL_MS = 30 * 60 * 1000;

/** Issue a voice session bound to one case. The browser later binds its Cartesia call ID to it. */
export const createVoiceSession = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("case not found");
    const token = `vs_${crypto.randomUUID().replace(/-/g, "")}`;
    const now = Date.now();
    await ctx.db.insert("voiceSessions", { token, caseId, createdAt: now, expiresAt: now + VOICE_SESSION_TTL_MS });
    await logActivity(ctx, caseId, "system", "voice_session_created", "Voice session issued (expires in 30 min).");
    return { token, expiresAt: now + VOICE_SESSION_TTL_MS };
  },
});

export const CALL_ID_PATTERN = /^ac_[A-Za-z0-9]{8,64}$/;

/**
 * Links a Cartesia call to the voice session (and so to one case). Browser access tokens may not
 * send dynamic variables, so the browser reports `session_ready.call_id` here, and the webhook
 * tool sends the same ID from Cartesia's `system__conversation_id`. A session binds exactly one
 * call and a call binds exactly one session; re-sending the same pair is a no-op.
 */
export const bindVoiceCall = mutation({
  args: { sessionToken: v.string(), callId: v.string() },
  handler: async (ctx, { sessionToken, callId }) => {
    if (!CALL_ID_PATTERN.test(callId)) throw new Error("invalid Cartesia call ID");
    const session = await ctx.db.query("voiceSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("unknown or expired voice session");
    if (session.callId === callId) return { ok: true as const };
    if (session.callId) throw new Error("voice session is already bound to another call");
    const other = await ctx.db.query("voiceSessions").withIndex("by_call", (q) => q.eq("callId", callId)).first();
    if (other) throw new Error("call is already bound to another voice session");
    await ctx.db.patch(session._id, { callId });
    await logActivity(ctx, session.caseId, "system", "voice_call_bound", `Voice call ${callId} linked to this case.`);
    return { ok: true as const };
  },
});

/** Called by the HTTP tool endpoint after authentication. The session is found by call ID (live calls) or token. */
export const recordVoiceUtterance = internalMutation({
  args: { sessionToken: v.optional(v.string()), callId: v.optional(v.string()), utterance: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { sessionToken, callId, utterance, idempotencyKey }) => {
    const session = callId
      ? await ctx.db.query("voiceSessions").withIndex("by_call", (q) => q.eq("callId", callId)).first()
      : sessionToken
        ? await ctx.db.query("voiceSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique()
        : null;
    if (!session || session.expiresAt < Date.now()) return { ok: false as const, error: callId ? "this call is not linked to a case (or its session expired)" : "unknown or expired voice session" };
    const r = await recordStatement(ctx, { caseId: session.caseId, text: utterance, channel: "voice", idempotencyKey });
    const c = await ctx.db.get(session.caseId);
    const analysis = c?.analysis as { questions?: { text: string; blocking: boolean }[]; recommendation?: { action: string } } | null;
    return {
      ok: true as const,
      ref: r.ref,
      duplicate: r.duplicate,
      openQuestions: (analysis?.questions ?? []).filter((q) => q.blocking).slice(0, 2).map((q) => q.text),
      recommendation: analysis?.recommendation?.action ?? null,
    };
  },
});

/** Mints a short-lived Cartesia access token for the browser (agent grant). Requires CARTESIA_API_KEY. */
export const createCartesiaAccessToken = action({
  args: {},
  handler: async (): Promise<{ ok: true; token: string; agentId: string | null } | { ok: false; error: string }> => {
    const key = process.env.CARTESIA_API_KEY;
    if (!key) return { ok: false, error: "CARTESIA_API_KEY is not set in the Convex environment" };
    const res = await fetch("https://api.cartesia.ai/access-token", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify({ grants: { agent: true }, expires_in: 60 }),
    });
    if (!res.ok) {
      // Cartesia-Version >= 2026-03-01 returns structured JSON errors; surface them (redacted).
      const detail = redact(await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `Cartesia access-token HTTP ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    const json = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (!json || typeof json.token !== "string") return { ok: false, error: "Cartesia access-token response missing token" };
    return { ok: true, token: json.token, agentId: process.env.CARTESIA_AGENT_ID ?? null };
  },
});
