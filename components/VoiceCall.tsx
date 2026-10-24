"use client";

/**
 * Browser voice call to the Cartesia Managed Agent for one case.
 * Flow: microphone permission → Convex issues a voice session (case-bound token) and a
 * short-lived Cartesia access token → agent WebSocket → session_create → session_ready{call_id}
 * → Convex binds call_id to the session → only then does the microphone start, so the agent's
 * tool (which sends the call ID) can never arrive before the binding exists.
 * Statements are recorded by the agent's record_statement webhook tool on the backend; the
 * transcript shown here is display only.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AGENT_SAMPLE_RATE, INPUT_CHUNK_SAMPLES, Resampler, decodePcm16Base64, encodePcm16Base64 } from "@/lib/voice/pcm";
import { agentWebSocketUrl, audioInputMessage, clientToolRefusal, parseAgentEvent, sessionCreateMessage } from "@/lib/voice/agentSocket";

/** Hard cap per call: agent minutes are billed. */
const MAX_CALL_SECONDS = 180;

const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

type Status = "idle" | "connecting" | "live" | "ended" | "error";
interface Turn { turn: number; role: "user" | "assistant"; text: string; interrupted: boolean }

interface CallResources {
  sessionToken: string | null;
  ws: WebSocket | null;
  ctx: AudioContext | null;
  stream: MediaStream | null;
  nodes: AudioNode[];
  sources: Set<AudioBufferSourceNode>;
  nextPlayTime: number;
  timer: ReturnType<typeof setInterval> | null;
}

const emptyResources = (): CallResources => ({ sessionToken: null, ws: null, ctx: null, stream: null, nodes: [], sources: new Set(), nextPlayTime: 0, timer: null });

interface VoiceCallProps {
  /** The case to bind the call to, or a resolver run when the call starts (the customer view creates its case lazily). */
  caseId: Id<"cases"> | (() => Promise<Id<"cases">>);
  /** "staff" (default) shows call internals; "customer" shows only the call controls and transcript. */
  variant?: "staff" | "customer";
  /** Told when a call starts or stops (the customer page locks its demo-persona picker during a call). */
  onInCallChange?: (inCall: boolean) => void;
}

export function VoiceCall({ caseId, variant = "staff", onInCallChange }: VoiceCallProps) {
  const createSession = useMutation(api.voice.createVoiceSession);
  const mintToken = useAction(api.voice.createCartesiaAccessToken);
  const bindCall = useMutation(api.voice.bindVoiceCall);
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const res = useRef<CallResources>(emptyResources());

  function stopPlayback() {
    for (const s of res.current.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    res.current.sources.clear();
    res.current.nextPlayTime = 0;
    setAgentSpeaking(false);
  }

  function play(b64: string) {
    const ctx = res.current.ctx;
    if (!ctx) return;
    const samples = decodePcm16Base64(b64);
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, AGENT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime + 0.02, res.current.nextPlayTime);
    src.start(start);
    res.current.nextPlayTime = start + buffer.duration;
    res.current.sources.add(src);
    setAgentSpeaking(true);
    src.onended = () => {
      res.current.sources.delete(src);
      if (res.current.sources.size === 0) setAgentSpeaking(false);
    };
  }

  /** Releases the microphone, audio graph, socket and timer. Safe to call more than once. */
  function teardown() {
    const r = res.current;
    res.current = emptyResources();
    if (r.timer) clearInterval(r.timer);
    for (const s of r.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    r.nodes.forEach((n) => n.disconnect());
    r.stream?.getTracks().forEach((t) => t.stop());
    if (r.ws && r.ws.readyState <= WebSocket.OPEN) r.ws.close(1000, "call ended by customer");
    void r.ctx?.close().catch(() => {});
    setAgentSpeaking(false);
  }

  function fail(message: string) {
    teardown();
    setStatus("error");
    setDetail(message);
  }

  function startMicrophone() {
    const { ctx, stream, ws } = res.current;
    if (!ctx || !stream || !ws) return;
    const source = ctx.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(ctx, "pcm-capture");
    const sink = ctx.createGain();
    sink.gain.value = 0; // keeps the worklet pulled without playing the mic back
    source.connect(capture).connect(sink).connect(ctx.destination);
    res.current.nodes.push(source, capture, sink);
    const resampler = new Resampler(ctx.sampleRate, AGENT_SAMPLE_RATE);
    let pending = new Float32Array(0);
    capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const out = resampler.push(e.data);
      const merged = new Float32Array(pending.length + out.length);
      merged.set(pending);
      merged.set(out, pending.length);
      let offset = 0;
      while (merged.length - offset >= INPUT_CHUNK_SAMPLES) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(audioInputMessage(encodePcm16Base64(merged.subarray(offset, offset + INPUT_CHUNK_SAMPLES)))));
        offset += INPUT_CHUNK_SAMPLES;
      }
      pending = merged.slice(offset);
    };
  }

  async function onSessionReady(callId: string) {
    const sessionToken = res.current.sessionToken;
    if (!sessionToken) return;
    setDetail(`Linking call ${callId} to this case…`);
    try {
      await bindCall({ sessionToken, callId });
    } catch (e) {
      return fail(`Could not link the call to this case: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.current.sessionToken !== sessionToken) return; // hung up while binding
    setStatus("live");
    setDetail(`Call ${callId}`);
    startMicrophone();
  }

  function onMessage(ev: MessageEvent) {
    const event = parseAgentEvent(ev.data);
    if (!event) return;
    switch (event.type) {
      case "session_ready":
        void onSessionReady(event.call_id);
        {
          let seconds = 0;
          res.current.timer = setInterval(() => {
            seconds += 1;
            setElapsed(seconds);
            if (seconds >= MAX_CALL_SECONDS) {
              teardown();
              setStatus("ended");
              setDetail(`Call ended automatically after ${MAX_CALL_SECONDS} s (cost limit).`);
            }
          }, 1000);
        }
        break;
      case "audio_output":
        play(event.audio);
        break;
      case "audio_output_clear":
        stopPlayback(); // barge-in
        break;
      case "turn_ended":
        if (event.text.trim()) setTurns((t) => [...t, { turn: event.turn, role: event.role, text: event.text, interrupted: event.interrupted }]);
        break;
      case "client_tool_call":
        if (event.expects_response) res.current.ws?.send(JSON.stringify(clientToolRefusal(event.tool_call_id)));
        break;
      case "error":
        if (event.fatal) fail(`Cartesia error${event.code ? ` (${event.code})` : ""}: ${event.message}`);
        else setDetail(`Cartesia warning${event.code ? ` (${event.code})` : ""}: ${event.message}`);
        break;
      case "malformed":
        setDetail(`Ignored a malformed agent message: ${event.detail}`);
        break;
    }
  }

  async function start() {
    setStatus("connecting");
    setDetail("Requesting microphone…");
    setTurns([]);
    setElapsed(0);
    try {
      // Microphone first: the permission prompt can take longer than the 60 s token lifetime.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      res.current.stream = stream;
      const ctx = new AudioContext();
      res.current.ctx = ctx;
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      setDetail("Starting voice session…");
      const session = await createSession({ caseId: typeof caseId === "function" ? await caseId() : caseId });
      res.current.sessionToken = session.token;
      const token = await mintToken({});
      if (!token.ok) return fail(token.error);
      if (!token.agentId) return fail("CARTESIA_AGENT_ID is not set in the Convex environment");
      setDetail("Connecting to the agent…");
      const ws = new WebSocket(agentWebSocketUrl(token.agentId, token.token));
      res.current.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(sessionCreateMessage()));
      ws.onmessage = onMessage;
      ws.onerror = () => setDetail("WebSocket error (see the close reason below).");
      ws.onclose = (e) => {
        if (res.current.ws !== ws) return; // already torn down by us
        teardown();
        setStatus(e.code === 1000 ? "ended" : "error");
        setDetail(`Connection closed (${e.code}${e.reason ? `: ${e.reason}` : ""}).`);
      };
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  function hangUp() {
    teardown();
    setStatus("ended");
    setDetail("You ended the call.");
  }

  // Release the microphone and socket if the page is left mid-call.
  useEffect(() => () => teardown(), []);

  const inCall = status === "connecting" || status === "live";
  useEffect(() => {
    onInCallChange?.(inCall);
  }, [inCall, onInCallChange]);
  if (variant === "customer") {
    // The boundary keeps a display error from unmounting VoiceCall, whose cleanup would hang up the call.
    return (
      <CallDisplayBoundary inCall={inCall} onHangUp={hangUp}>
        <CustomerCallView status={status} detail={detail} turns={turns} elapsed={elapsed} agentSpeaking={agentSpeaking} onStart={start} onHangUp={hangUp} />
      </CallDisplayBoundary>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <h3>Voice call <span className="muted">(Cartesia agent; billed per minute, max {MAX_CALL_SECONDS / 60} min)</span></h3>
      {!inCall ? <button onClick={start}>Start voice call</button> : <button onClick={hangUp}>Hang up</button>}{" "}
      <span className="label">{status}</span>
      {status === "live" && <span className="muted"> {elapsed}s{agentSpeaking ? " · agent speaking" : " · listening"}</span>}
      {detail && <p className={status === "error" ? "error" : "muted"}>{detail}</p>}
      {turns.length > 0 && (
        <div>
          <div className="muted">Call transcript (display only; statements above are recorded by the agent&apos;s tool):</div>
          {turns.map((t) => (
            <div key={`${t.role}-${t.turn}`}>
              <strong>{t.role === "user" ? "Customer" : "Agent"}:</strong> {t.text}
              {t.interrupted && <span className="muted"> (interrupted)</span>}
            </div>
          ))}
        </div>
      )}
      <p className="muted">Use headphones: without them the agent may hear itself and keep interrupting.</p>
    </div>
  );
}

const CUSTOMER_STATUS: Record<Status, string> = {
  idle: "Tap the button to talk to our fraud support assistant.",
  connecting: "Connecting you…",
  live: "",
  ended: "Your call has ended. Thank you — a member of our team will review your report.",
  error: "We couldn't complete the call. Please try again.",
};

const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Catches errors in the call display only. Without it, a rendering bug unmounts the whole call
 * component, and its cleanup closes the agent socket: the call ends and the statement in
 * progress is never recorded (seen live 2026-10-24). The call keeps running behind a minimal view.
 */
class CallDisplayBoundary extends Component<{ inCall: boolean; onHangUp: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("Call display error (call kept running):", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="cc-call">
        {this.props.inCall && (
          <button className="cc-call-button cc-hang-up" onClick={this.props.onHangUp}>
            End call
          </button>
        )}
        <p className="cc-status">{this.props.inCall ? "Your call is still connected. Go ahead and speak." : "Please reload the page to start a new call."}</p>
      </div>
    );
  }
}

/** Customer-facing presentation: no case data, costs or call internals. */
function CustomerCallView(props: { status: Status; detail: string | null; turns: Turn[]; elapsed: number; agentSpeaking: boolean; onStart: () => void; onHangUp: () => void }) {
  const { status, detail, turns, elapsed, agentSpeaking, onStart, onHangUp } = props;
  const inCall = status === "connecting" || status === "live";
  const transcriptEnd = useRef<HTMLDivElement>(null);
  // Braces matter: an effect may only return a cleanup function, and some browsers' scrollIntoView returns a Promise.
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);
  const message = status === "live" ? (agentSpeaking ? "Assistant is speaking…" : "Listening — go ahead and speak.") : CUSTOMER_STATUS[status];
  return (
    <div className="cc-call">
      <button className={`cc-call-button${inCall ? " cc-hang-up" : ""}`} onClick={inCall ? onHangUp : onStart}>
        {inCall ? "End call" : status === "idle" ? "Start call" : "Call again"}
      </button>
      <p className="cc-status" aria-live="polite">
        {message}
        {status === "live" && <span className="cc-clock"> {formatClock(elapsed)} / {formatClock(MAX_CALL_SECONDS)}</span>}
      </p>
      {status === "error" && detail && <p className="cc-detail error">{detail}</p>}
      {turns.length > 0 && (
        <div className="cc-transcript">
          {turns.map((t) => (
            <div key={`${t.role}-${t.turn}`} className={`cc-bubble ${t.role === "user" ? "cc-user" : "cc-agent"}`}>
              <span className="cc-speaker">{t.role === "user" ? "You" : "Assistant"}</span>
              {t.text}
              {t.interrupted && <span className="muted"> …</span>}
            </div>
          ))}
          <div ref={transcriptEnd} />
        </div>
      )}
      {!inCall && <p className="muted">For the best experience, use headphones. Calls last up to {MAX_CALL_SECONDS / 60} minutes.</p>}
    </div>
  );
}
