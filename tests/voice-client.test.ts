import { describe, expect, it } from "vitest";
import { INPUT_CHUNK_SAMPLES, Resampler, decodePcm16Base64, encodePcm16Base64 } from "@/lib/voice/pcm";
import { agentWebSocketUrl, clientToolRefusal, parseAgentEvent, sessionCreateMessage } from "@/lib/voice/agentSocket";

describe("PCM encoding", () => {
  it("encodes 16-bit little-endian and round-trips within one quantization step", () => {
    const b64 = encodePcm16Base64(Float32Array.from([0, 1, -1]));
    expect([...Buffer.from(b64, "base64")]).toEqual([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
    const input = Float32Array.from([0, 0.5, -0.25, 0.999, -1]);
    const back = decodePcm16Base64(encodePcm16Base64(input));
    back.forEach((v, i) => expect(Math.abs(v - input[i]!)).toBeLessThan(1 / 0x7fff + 1e-6));
  });

  it("clamps out-of-range samples", () => {
    expect([...decodePcm16Base64(encodePcm16Base64(Float32Array.from([2, -3])))]).toEqual([1, -1]);
  });
});

describe("Resampler", () => {
  it("downsamples 48 kHz to 16 kHz with the right length across chunk boundaries", () => {
    const r = new Resampler(48_000, 16_000);
    let total = 0;
    for (let i = 0; i < 375; i++) total += r.push(new Float32Array(128)).length; // 1 s of 128-sample frames
    expect(Math.abs(total - 16_000)).toBeLessThanOrEqual(1);
  });

  it("keeps a continuous signal continuous across chunks", () => {
    const ramp = Float32Array.from({ length: 4800 }, (_, i) => i / 4800);
    const r = new Resampler(48_000, 16_000);
    const out = [...r.push(ramp.subarray(0, 1000)), ...r.push(ramp.subarray(1000, 2500)), ...r.push(ramp.subarray(2500))];
    for (let i = 1; i < out.length; i++) expect(out[i]! - out[i - 1]!).toBeCloseTo(3 / 4800, 6);
  });

  it("chunks are within the documented 20–100 ms window", () => {
    expect((INPUT_CHUNK_SAMPLES / 16_000) * 1000).toBe(40);
  });
});

describe("agent WebSocket protocol", () => {
  it("builds the browser URL with version and access token as query parameters", () => {
    const u = new URL(agentWebSocketUrl("agent_abc", "tok/with+chars"));
    expect(`${u.protocol}//${u.host}${u.pathname}`).toBe("wss://api.cartesia.ai/v1/agents/websocket/agent_abc");
    expect(u.searchParams.get("cartesia_version")).toBe("2026-08-14");
    expect(u.searchParams.get("access_token")).toBe("tok/with+chars");
  });

  it("sends no dynamic_variables in session_create (browser tokens may not)", () => {
    expect(sessionCreateMessage()).toEqual({
      type: "session_create",
      audio: { input_format: "pcm_16000", output_delivery: "speaking_pace", continuous_input: true },
    });
  });

  it("parses known events, ignores unknown ones, and flags malformed ones", () => {
    expect(parseAgentEvent(JSON.stringify({ type: "session_ready", call_id: "ac_1", agent_id: "a", agent_version_id: "v", audio: {} }))).toMatchObject({ type: "session_ready", call_id: "ac_1" });
    expect(parseAgentEvent(JSON.stringify({ type: "turn_ended", turn: 2, role: "user", text: "hi", interrupted: false, start_time: 0, end_time: 1, tool_calls: [] }))).toMatchObject({ type: "turn_ended", text: "hi" });
    expect(parseAgentEvent(JSON.stringify({ type: "error", message: "bad", fatal: true }))).toMatchObject({ type: "error", fatal: true });
    expect(parseAgentEvent(JSON.stringify({ type: "something_new" }))).toBeNull();
    expect(parseAgentEvent(JSON.stringify({ type: "audio_output" }))).toEqual({ type: "malformed", detail: "unexpected audio_output shape" });
    expect(parseAgentEvent("not json")).toEqual({ type: "malformed", detail: "non-JSON message" });
  });

  it("refuses client tool calls with an error result", () => {
    expect(clientToolRefusal("call_1")).toEqual({ type: "client_tool_result", tool_call_id: "call_1", result: "This application has no client tools.", is_error: true });
  });
});
