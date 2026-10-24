"use client";

/**
 * The customer's call canvas: Bellhop inside rings that follow the live audio level,
 * one word of state beneath it, and three round controls. The transcript is a panel the customer
 * opens; it never competes with the call. Reduced motion keeps the rings still and shows state by
 * tone only.
 */
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useReducedMotion } from "motion/react";
import { MessageSquare, Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import Image from "next/image";

export type CallStatus = "idle" | "connecting" | "live" | "ended" | "error";
export interface CallTurn {
  turn: number;
  role: "user" | "assistant";
  text: string;
  interrupted: boolean;
}
/** Live audio levels, 0–1, written by the call without re-rendering. */
export interface AudioLevels {
  mic: number;
  agent: number;
}

const STATE_LABEL: Record<CallStatus, string> = { idle: "Ready", connecting: "Connecting", live: "Listening", ended: "Call ended", error: "Couldn't connect" };
const NOTE: Partial<Record<CallStatus, string>> = { idle: "Use headphones. Calls last up to 3 minutes.", ended: "Thank you. Our team will review your report.", error: "Please try again." };

const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function CustomerCallView(props: { status: CallStatus; detail: string | null; turns: CallTurn[]; elapsed: number; maxSeconds: number; agentSpeaking: boolean; muted: boolean; levels: MutableRefObject<AudioLevels>; onStart: () => void; onHangUp: () => void; onToggleMute: () => void }) {
  const { status, detail, turns, elapsed, maxSeconds, agentSpeaking, muted, levels, onStart, onHangUp, onToggleMute } = props;
  const inCall = status === "connecting" || status === "live";
  const reduce = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  // The rings follow the louder of the two live levels, smoothed, through one CSS variable.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (reduce || status !== "live") {
      el.style.setProperty("--lv", "0");
      return;
    }
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const target = Math.max(levels.current.mic, levels.current.agent);
      shown += (target - shown) * (target > shown ? 0.35 : 0.12);
      el.style.setProperty("--lv", shown.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce, status, levels]);

  useEffect(() => {
    if (transcriptOpen) transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, transcriptOpen]);

  const label = status === "live" && agentSpeaking ? "Speaking" : STATE_LABEL[status];
  const activity = status === "live" ? (agentSpeaking ? "agent" : "customer") : status;
  return (
    <div className="cl-canvas" data-transcript={transcriptOpen || undefined}>
      <div ref={stage} className="cl-stage" data-activity={activity} data-muted={muted || undefined}>
        <div className="cl-rings" aria-hidden="true">
          <span className="cl-ring cl-ring-3" />
          <span className="cl-ring cl-ring-2" />
          <span className="cl-ring cl-ring-1" />
        </div>
        <Image src="/bellhop.png" alt="Bellhop, the assistant" width={176} height={176} className="cl-figure" priority />
      </div>
      <p className="cl-state" aria-live="polite">
        {label}
      </p>
      <p className="cl-note">
        {status === "live" ? `${formatClock(elapsed)} / ${formatClock(maxSeconds)}` : status === "connecting" ? (detail ?? "") : (NOTE[status] ?? "")}
        {status === "error" && detail ? <span className="cl-error">{detail}</span> : null}
      </p>

      <div className="cl-controls">
        <button type="button" className="cl-ctl" aria-label={muted ? "Unmute microphone" : "Mute microphone"} aria-pressed={muted} disabled={!inCall} onClick={onToggleMute}>
          {muted ? <MicOff size={22} aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}
        </button>
        {inCall ? (
          <button type="button" className="cl-ctl cl-ctl-end" aria-label="End call" onClick={onHangUp}>
            <PhoneOff size={24} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="cl-ctl cl-ctl-start" aria-label={status === "idle" ? "Start call" : "Call again"} onClick={onStart}>
            <Phone size={24} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="cl-ctl" aria-label={transcriptOpen ? "Hide transcript" : "Show transcript"} aria-pressed={transcriptOpen} aria-controls="cl-transcript" onClick={() => setTranscriptOpen((v) => !v)}>
          <MessageSquare size={22} aria-hidden="true" />
          {turns.length > 0 && <span className="cl-badge">{turns.length}</span>}
        </button>
      </div>

      <aside id="cl-transcript" className="cl-transcript" aria-label="Transcript" hidden={!transcriptOpen}>
        <div className="cl-transcript-head">
          <span>Transcript</span>
          <button type="button" className="cl-close" aria-label="Close transcript" onClick={() => setTranscriptOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="cl-transcript-body">
          {turns.length === 0 ? (
            <p className="cl-transcript-empty">{inCall ? "Nothing said yet." : "No transcript yet."}</p>
          ) : (
            turns.map((t) => (
              <div key={`${t.role}-${t.turn}`} className={`cl-bubble ${t.role === "user" ? "cl-bubble-user" : "cl-bubble-agent"}`}>
                <span className="cl-speaker">{t.role === "user" ? "You" : "Assistant"}</span>
                {t.text}
                {t.interrupted && <span className="cl-cut"> …</span>}
              </div>
            ))
          )}
          <div ref={transcriptEnd} />
        </div>
      </aside>
    </div>
  );
}
