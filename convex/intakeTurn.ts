/**
 * One customer turn, shared by the voice webhook (convex/http.ts) and the text chat
 * (convex/chat.ts): wait briefly for the live interpretation of what the customer just said, then
 * for the reasoning model's reassessment, then issue the next question. Both channels get the
 * same questions, answer linking, repeat limits, wrap-up and closing.
 */
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { VoiceToolResponse } from "./voice";

/**
 * How long a turn waits for a live interpretation before answering without it. Bitdeer
 * (GLM-5.3-Flash) measured 4.7–7.0 s per statement on a live call (2026-10-24). The agent tells the
 * customer to wait before every tool call, so the wait can cover slow statements; Cartesia's tool
 * timeout is 20 s (lib/providers/cartesia.ts), so the cap stays well under it.
 */
const DEFAULT_INTERPRETATION_WAIT_MS = 12_000;
const MAX_INTERPRETATION_WAIT_MS = 15_000;
/**
 * Total time a turn may wait, including the reasoning model's reassessment that chooses the next
 * question. If the reassessment isn't ready by then, the rule-based question is used (logged).
 * Stays under the tool's 20 s timeout; the customer has been told to wait.
 */
const MAX_TOTAL_WAIT_MS = 16_000;
const POLL_MS = 250;

function interpretationWaitMs(): number {
  const raw = process.env.VOICE_INTERPRETATION_WAIT_MS;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_INTERPRETATION_WAIT_MS) : DEFAULT_INTERPRETATION_WAIT_MS;
}

export interface RecordedTurn {
  sessionId: Id<"voiceSessions">;
  idempotencyKey: string;
  ref: string;
  duplicate: boolean;
  pending: boolean;
  statementId?: Id<"statements"> | null;
}

export async function takeTurn(ctx: Pick<GenericActionCtx<DataModel>, "runQuery" | "runMutation">, result: RecordedTurn): Promise<VoiceToolResponse> {
  // Live interpretation runs in the background. Wait for it so the next question reflects what the
  // customer just said; if it still isn't ready, the next question comes from earlier statements.
  let awaiting = result.pending;
  const started = Date.now();
  if (awaiting && result.statementId) {
    const deadline = started + interpretationWaitMs();
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const status = await ctx.runQuery(internal.voice.statementStatus, { statementId: result.statementId });
      if (status !== "pending") {
        // A failed interpretation (e.g. provider out of credits) must not stall the conversation:
        // it is shown on the case, and the conversation continues with the next question.
        awaiting = false;
        break;
      }
    }
  }
  // Once the statement is interpreted, the reasoning model reassesses the case and picks the next
  // question. The reassessment row is created in the same transaction that stores the
  // interpretation, so "not pending" here means there is nothing to wait for.
  if (!awaiting) {
    const deadline = started + MAX_TOTAL_WAIT_MS;
    while (Date.now() < deadline && (await ctx.runQuery(internal.voice.assessmentPending, { sessionId: result.sessionId }))) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  // Questions come from the backend: a reviewer's, the model's, or the rules' as the fallback. No
  // recommendation or eligibility is sent to the customer.
  return await ctx.runMutation(internal.voice.issueVoiceQuestion, {
    sessionId: result.sessionId,
    idempotencyKey: result.idempotencyKey,
    ref: result.ref,
    duplicate: result.duplicate,
    awaitingInterpretation: awaiting,
  });
}
