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
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { logActivity, recordStatement } from "./model";
import { redact } from "../lib/providers/errors";
import { CARTESIA_VERSION } from "../lib/providers/cartesia";
import { voiceIdempotencyKey } from "../lib/domain/idempotency";
import { AWAITING_PROMPT, MAX_ASKS_PER_CALL, selectVoiceQuestion } from "../lib/domain/voiceTurn";
import type { OpenQuestion } from "../lib/domain/schemas";

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

/** Replies this short don't wait for the live model (see recordVoiceUtterance). */
export const SHORT_REPLY_WORDS = 4;

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

/** What the record_statement tool returns to the agent (and what a retry gets back unchanged). */
export interface VoiceToolResponse {
  recorded: string;
  duplicate: boolean;
  /** Echo this back as `question_id` on the next tool call. Null when no question was issued. */
  question_id: string | null;
  /** The one question to ask next, in the agent's own words. Null: ask whether there is anything else. */
  question: string | null;
  /** Kept for agents configured with the earlier instructions ("ask the first next_questions item"). */
  next_questions: string[];
  /** True when the statement is still being interpreted: acknowledge, don't move on to new topics. */
  awaiting_interpretation: boolean;
}

/**
 * Step 1 of a tool call (called by the HTTP endpoint after authentication). Finds the session by
 * call ID (live calls) or token, works out which question the utterance answers, and records it.
 *
 * The idempotency key names that question, so "Yes." to two different questions is two
 * statements, while a retried call (same question, same words) returns the stored response.
 */
export const recordVoiceUtterance = internalMutation({
  args: {
    sessionToken: v.optional(v.string()),
    callId: v.optional(v.string()),
    utterance: v.string(),
    utteranceKey: v.string(),
    /** question_id the agent echoed from the previous result. Accepted only if issued on this call. */
    questionId: v.optional(v.string()),
  },
  handler: async (ctx, { sessionToken, callId, utterance, utteranceKey, questionId }) => {
    const session = callId
      ? await ctx.db.query("voiceSessions").withIndex("by_call", (q) => q.eq("callId", callId)).first()
      : sessionToken
        ? await ctx.db.query("voiceSessions").withIndex("by_token", (q) => q.eq("token", sessionToken)).unique()
        : null;
    if (!session || session.expiresAt < Date.now()) return { ok: false as const, error: callId ? "this call is not linked to a case (or its session expired)" : "unknown or expired voice session" };

    const echoedId = questionId ? ctx.db.normalizeId("intakeTurns", questionId) : null;
    const echoed = echoedId ? await ctx.db.get(echoedId) : null;
    const lastTurn = await ctx.db.query("intakeTurns").withIndex("by_session", (q) => q.eq("sessionId", session._id)).order("desc").first();
    // An echoed ID from another session is ignored, never trusted.
    const askedTurn = echoed && echoed.sessionId === session._id ? echoed : lastTurn;
    const idempotencyKey = voiceIdempotencyKey(callId ?? sessionToken!, askedTurn?._id ?? null, utteranceKey);

    const prior = await ctx.db.query("processedEvents").withIndex("by_key", (q) => q.eq("key", idempotencyKey)).unique();
    if (prior?.response) {
      if (prior.caseId !== session.caseId) throw new Error("idempotency key belongs to a different case");
      return { ok: true as const, sessionId: session._id, idempotencyKey, ref: prior.resultRef ?? "", duplicate: true, pending: false, storedResponse: JSON.parse(prior.response) as VoiceToolResponse };
    }

    // The reply is context for the question only if the agent said so, or the last question is still unanswered.
    const replyTo = askedTurn && (askedTurn === echoed || !askedTurn.answeredByRef) ? askedTurn : null;
    const r = await recordStatement(ctx, {
      caseId: session.caseId,
      text: utterance,
      channel: "voice",
      idempotencyKey,
      ...(replyTo ? { inResponseTo: { key: replyTo.questionKey, kind: replyTo.kind, text: replyTo.text } } : {}),
    });
    if (!r.duplicate && replyTo && !replyTo.answeredByRef) await ctx.db.patch(replyTo._id, { answeredByRef: r.ref });
    const s = r.statementId ? await ctx.db.get(r.statementId) : null;
    // Short replies ("No, I'm done.", "me") carry no new facts, or the rule-based answer reader has
    // already read them against the question: don't make the caller wait for the live model.
    const settledByAnswer = !!s?.answer && s.answer.state !== "unparsed";
    const shortReply = (s?.text.trim().split(/\s+/).length ?? 0) <= SHORT_REPLY_WORDS;
    return {
      ok: true as const,
      sessionId: session._id,
      idempotencyKey,
      ref: r.ref,
      duplicate: r.duplicate,
      pending: s?.interpretationStatus === "pending" && !settledByAnswer && !shortReply,
      statementId: r.statementId,
      storedResponse: null,
    };
  },
});

/** Polled by the HTTP endpoint while a live interpretation is in flight. */
export const statementStatus = internalQuery({
  args: { statementId: v.id("statements") },
  handler: async (ctx, { statementId }) => (await ctx.db.get(statementId))?.interpretationStatus ?? null,
});

/**
 * Step 2 of a tool call: chooses the next question from the (now current) analysis, logs it as
 * issued on this call, and stores the response so a retry gets the same one.
 */
export const issueVoiceQuestion = internalMutation({
  args: { sessionId: v.id("voiceSessions"), idempotencyKey: v.string(), ref: v.string(), duplicate: v.boolean(), awaitingInterpretation: v.boolean() },
  handler: async (ctx, { sessionId, idempotencyKey, ref, duplicate, awaitingInterpretation }): Promise<VoiceToolResponse> => {
    const event = await ctx.db.query("processedEvents").withIndex("by_key", (q) => q.eq("key", idempotencyKey)).unique();
    if (event?.response) return JSON.parse(event.response) as VoiceToolResponse;
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("voice session not found");
    const c = await ctx.db.get(session.caseId);
    if (!c) throw new Error("case not found");

    let response: VoiceToolResponse;
    // Acknowledge at most once in a row; otherwise a slow model loops the call on "anything else?"
    // (seen live 2026-10-24: three acknowledgements, no question). The second time, ask the next
    // question from what is already interpreted.
    const acknowledge = awaitingInterpretation && !session.lastResponseWasAck;
    if (awaitingInterpretation && !acknowledge) {
      await logActivity(ctx, session.caseId, "voice", "asked_without_waiting", `${ref} was still being interpreted, but the previous turn was already an acknowledgement, so the next question was asked from the statements interpreted so far.`);
    }
    if (acknowledge) {
      // The newest statement isn't interpreted yet, so any case question could already be answered by it.
      response = { recorded: ref, duplicate, question_id: null, question: AWAITING_PROMPT, next_questions: [AWAITING_PROMPT], awaiting_interpretation: true };
      await logActivity(ctx, session.caseId, "voice", "awaiting_interpretation", `${ref} was not interpreted in time; the agent was told to acknowledge rather than ask a possibly stale question.`);
    } else {
      const questions = ((c.analysis as { questions?: OpenQuestion[] } | null)?.questions ?? []).filter((q) => q.audience === "customer");
      const counts = new Map<string, number>();
      for (const q of questions) {
        const asked = await ctx.db.query("intakeTurns").withIndex("by_session_key", (x) => x.eq("sessionId", sessionId).eq("questionKey", q.key)).collect();
        counts.set(q.key, asked.length);
      }
      const choice = selectVoiceQuestion(questions, counts);
      const handedOff = new Set(session.handedOffKeys ?? []);
      const newlyHandedOff = choice.exhausted.filter((q) => !handedOff.has(q.key));
      if (newlyHandedOff.length) {
        await ctx.db.patch(sessionId, { handedOffKeys: [...handedOff, ...newlyHandedOff.map((q) => q.key)] });
        await logActivity(ctx, session.caseId, "voice", "question_handed_to_reviewer", `Asked ${MAX_ASKS_PER_CALL} times on this call without being settled, so not asked again: ${newlyHandedOff.map((q) => `"${q.text}"`).join("; ")}. Needs reviewer follow-up.`);
      }
      if (choice.question) {
        const turnId = await ctx.db.insert("intakeTurns", {
          caseId: session.caseId,
          sessionId,
          questionKey: choice.question.key,
          kind: choice.question.kind,
          text: choice.question.text,
          issuedAt: Date.now(),
          analysisVersion: c.analysisVersion,
        });
        response = { recorded: ref, duplicate, question_id: turnId, question: choice.question.text, next_questions: [choice.question.text], awaiting_interpretation: false };
      } else {
        response = { recorded: ref, duplicate, question_id: null, question: null, next_questions: [], awaiting_interpretation: false };
      }
    }
    if (event) await ctx.db.patch(event._id, { response: JSON.stringify(response) });
    await ctx.db.patch(sessionId, { lastResponseWasAck: acknowledge });
    return response;
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
