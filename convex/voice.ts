/**
 * Voice channel (Cartesia). Voice utterances enter the SAME recordStatement path as text.
 *
 * Architecture (docs/architecture.md#voice):
 *  - Browser asks Convex for a short-lived Cartesia access token (permanent key stays server-side).
 *  - A Cartesia Managed Agent handles the call. Its webhook tool POSTs finalized utterances
 *    to the Convex HTTP endpoint /voice/tools/record-statement (convex/http.ts).
 *  - The case is identified by a backend-issued voice session token, not by the model.
 */
import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import { logActivity, recordStatement } from "./model";
import { redact } from "../lib/providers/errors";

export const VOICE_SESSION_TTL_MS = 30 * 60 * 1000;
export const CARTESIA_VERSION = "2026-08-14";

/** Issue a voice session bound to one case. The token is passed to the agent as a dynamic variable. */
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

/** Called by the HTTP tool endpoint after authentication. */
export const recordVoiceUtterance = internalMutation({
  args: { sessionToken: v.string(), utterance: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { sessionToken, utterance, idempotencyKey }) => {
    const session = await ctx.db.query("voiceSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique();
    if (!session || session.expiresAt < Date.now()) return { ok: false as const, error: "unknown or expired voice session" };
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
