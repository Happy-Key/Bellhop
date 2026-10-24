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
import { voiceIdempotencyKey } from "../lib/domain/idempotency";

const ToolBody = z.object({
  session_token: z.string().regex(/^vs_[a-f0-9]{32}$/),
  utterance: z.string().min(1).max(4000),
  turn_id: z.string().min(1).max(128).optional(),
});

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
    const { session_token, utterance, turn_id } = parsed.data;
    const key = await voiceIdempotencyKey(session_token, utterance, turn_id);
    const result = await ctx.runMutation(internal.voice.recordVoiceUtterance, { sessionToken: session_token, utterance, idempotencyKey: key });
    if (!result.ok) return json(404, { error: result.error });
    // Plain, short response the voice agent can relay. Questions come from the backend workflow.
    return json(200, {
      recorded: result.ref,
      duplicate: result.duplicate,
      next_questions: result.openQuestions,
      recommended_action: result.recommendation,
    });
  }),
});

export default http;
