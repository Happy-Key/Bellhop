/**
 * Cartesia Managed Agent WebSocket protocol (browser side).
 * Verified in docs 2026-10-23: https://docs.cartesia.ai/line/integrations/websocket-api.md and
 * https://docs.cartesia.ai/api-reference/agents/agent-websocket.md
 *
 * - Browsers authenticate with `?access_token=` (minted by Convex, agent grant only).
 * - `session_create` must be the first message, within 10 s; unknown fields are rejected.
 * - Browser tokens may NOT send `dynamic_variables` (`dynamic_variables_not_allowed`, seen live
 *   2026-10-24). Instead the browser binds `session_ready.call_id` to its voice session in Convex.
 * - New server event types may appear, so unknown ones are ignored, not treated as errors.
 */
import { z } from "zod";
import { CARTESIA_VERSION } from "../providers/cartesia";
import { AGENT_INPUT_FORMAT } from "./pcm";

export function agentWebSocketUrl(agentId: string, accessToken: string): string {
  const qs = new URLSearchParams({ cartesia_version: CARTESIA_VERSION, access_token: accessToken });
  return `wss://api.cartesia.ai/v1/agents/websocket/${encodeURIComponent(agentId)}?${qs}`;
}

export function sessionCreateMessage() {
  return {
    type: "session_create",
    // continuous_input: the microphone streams constantly (including silence).
    audio: { input_format: AGENT_INPUT_FORMAT, output_delivery: "speaking_pace", continuous_input: true },
  } as const;
}

export const audioInputMessage = (audio: string) => ({ type: "audio_input", audio }) as const;

/** We register no client tools, so any client tool call gets an error result. */
export const clientToolRefusal = (toolCallId: string) =>
  ({ type: "client_tool_result", tool_call_id: toolCallId, result: "This application has no client tools.", is_error: true }) as const;

const Role = z.enum(["user", "assistant"]);
const AgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session_ready"), call_id: z.string() }).loose(),
  z.object({ type: z.literal("audio_output"), audio: z.string() }).loose(),
  z.object({ type: z.literal("audio_output_clear") }).loose(),
  z.object({ type: z.literal("turn_started"), turn: z.number(), role: Role }).loose(),
  z.object({ type: z.literal("turn_ended"), turn: z.number(), role: Role, text: z.string(), interrupted: z.boolean() }).loose(),
  z.object({ type: z.literal("client_tool_call"), tool_call_id: z.string(), tool_name: z.string(), expects_response: z.boolean() }).loose(),
  z.object({ type: z.literal("error"), message: z.string(), fatal: z.boolean().optional(), code: z.string().nullish() }).loose(),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

const KNOWN = new Set(["session_ready", "audio_output", "audio_output_clear", "turn_started", "turn_ended", "client_tool_call", "error"]);

/**
 * Returns the parsed event, `null` for event types we don't handle, or a synthetic
 * `malformed` marker when a known event doesn't match its schema (shown to the user).
 */
export function parseAgentEvent(data: unknown): AgentEvent | { type: "malformed"; detail: string } | null {
  let json: unknown;
  try {
    json = typeof data === "string" ? JSON.parse(data) : null;
  } catch {
    return { type: "malformed", detail: "non-JSON message" };
  }
  const type = (json as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !KNOWN.has(type)) return null;
  const parsed = AgentEvent.safeParse(json);
  return parsed.success ? parsed.data : { type: "malformed", detail: `unexpected ${type} shape` };
}
