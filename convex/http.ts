/**
 * HTTP endpoints for the Cartesia Managed Agent webhook tool.
 * URL: https://<deployment>.convex.site/voice/tools/record-statement
 *
 * Auth: `Authorization: Bearer <VOICE_TOOL_SECRET>` configured on the Cartesia tool.
 * The case comes from session_token (a dynamic variable set when the call starts),
 * never from model-chosen identifiers. Utterance text is evidence, not instructions.
 */
import { httpRouter } from "convex/server";
import { z } from "zod";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { voiceUtteranceKey } from "../lib/domain/idempotency";
import { CALL_ID_PATTERN } from "./voice";

// Live calls send call_id (from Cartesia's system__conversation_id). session_token remains for
// direct testing. Exactly one must be present.
const ToolBody = z
  .object({
    call_id: z.string().regex(CALL_ID_PATTERN).optional(),
    session_token: z.string().regex(/^vs_[a-f0-9]{32}$/).optional(),
    utterance: z.string().min(1).max(4000),
    turn_id: z.string().min(1).max(128).optional(),
    // Echo of the previous result's question_id. Model-supplied, so it only disambiguates which
    // question was answered; it is checked against questions issued on this call.
    question_id: z.string().min(1).max(64).nullish(),
  })
  .refine((b) => !!b.call_id !== !!b.session_token, "exactly one of call_id or session_token");

/**
 * How long the tool call waits for a live interpretation before answering without it. Bitdeer
 * (GLM-5.3-Flash) measured 4.7–7.0 s per statement on a live call (2026-10-24); Cartesia's tool
 * timeout is 15 s (lib/providers/cartesia.ts), so the cap stays well under it.
 */
const DEFAULT_INTERPRETATION_WAIT_MS = 8000;
const MAX_INTERPRETATION_WAIT_MS = 12_000;
const POLL_MS = 250;

function interpretationWaitMs(): number {
  const raw = process.env.VOICE_INTERPRETATION_WAIT_MS;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_INTERPRETATION_WAIT_MS) : DEFAULT_INTERPRETATION_WAIT_MS;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const http = httpRouter();

http.route({
  path: "/voice/tools/record-statement",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.VOICE_TOOL_SECRET;
    if (!secret) return json(503, { error: "voice tool not configured" });
    const auth = req.headers.get("authorization") ?? "";
    if (!safeEqual(auth, `Bearer ${secret}`)) return json(401, { error: "unauthorized" });

    const parsed = ToolBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(400, { error: "invalid body" });
    const { call_id, session_token, utterance, turn_id, question_id } = parsed.data;
    const result = await ctx.runMutation(internal.voice.recordVoiceUtterance, {
      ...(call_id ? { callId: call_id } : { sessionToken: session_token }),
      utterance,
      utteranceKey: await voiceUtteranceKey(utterance, turn_id),
      ...(question_id ? { questionId: question_id } : {}),
    });
    if (!result.ok) return json(404, { error: result.error });
    // A retry gets exactly the response the first call got.
    if (result.storedResponse) return json(200, { ...result.storedResponse, duplicate: true });

    // Live interpretation runs in the background. Wait for it briefly so the next question reflects
    // what the customer just said; if it isn't ready, the agent is told to acknowledge instead.
    let awaiting = result.pending;
    if (awaiting && "statementId" in result && result.statementId) {
      const deadline = Date.now() + interpretationWaitMs();
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const status = await ctx.runQuery(internal.voice.statementStatus, { statementId: result.statementId });
        if (status !== "pending") {
          // A failed interpretation (e.g. provider out of credits) must not stall the call: it is
          // shown on the case, and the conversation continues with the next question.
          awaiting = false;
          break;
        }
      }
    }
    // Questions come from the backend workflow. No recommendation or eligibility is sent to the agent.
    const response = await ctx.runMutation(internal.voice.issueVoiceQuestion, {
      sessionId: result.sessionId,
      idempotencyKey: result.idempotencyKey,
      ref: result.ref,
      duplicate: result.duplicate,
      awaitingInterpretation: awaiting,
    });
    return json(200, response);
  }),
});

export default http;
