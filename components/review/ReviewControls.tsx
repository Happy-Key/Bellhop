"use client";

/**
 * Reviewer controls. The backend has no review actions yet, so a live case only says so; the
 * synthetic demo shows the controls with changes kept in browser memory and labelled as unsaved.
 * No control approves, denies, sends a notice or moves money.
 */
import Link from "next/link";
import { useState } from "react";
import type { NextStep } from "@/lib/domain/triage";
import { REVIEW_ACTION_LABEL } from "@/lib/review/timeline";
import type { DemoReviewEvent } from "@/lib/review/types";
import { clockTime } from "./format";

const ACTIONS: { id: DemoReviewEvent["action"]; label: string }[] = [
  { id: "accept", label: "Accept proposed next step" },
  { id: "request_info", label: "Request more information" },
  { id: "return", label: "Return for additional investigation" },
  { id: "escalate", label: "Escalate for review" },
  { id: "override", label: "Record override reason" },
];

export function LiveReviewNote() {
  return (
    <section className="ws-stepgroup ws-review" aria-label="Review decisions">
      <h3 className="ws-stepgroup-head">Review decisions</h3>
      <p className="ws-small ws-muted">
        Not available: the backend has no persisted review actions yet. <Link href="/review/demo">Preview the controls in the synthetic demo</Link>.
      </p>
    </section>
  );
}

export function DemoReviewControls({ step, events, onAction }: { step: NextStep | null; events: DemoReviewEvent[]; onAction: (action: DemoReviewEvent["action"], reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const act = (id: DemoReviewEvent["action"]) => {
    if (id === "override" && !reason.trim()) {
      setError("An override needs a reason.");
      return;
    }
    setError("");
    onAction(id, reason.trim());
    setStatus(`Demo only, not saved: ${REVIEW_ACTION_LABEL[id]}.`);
    setReason("");
  };
  return (
    <section className="ws-stepgroup ws-review ws-review-demo" aria-labelledby="review-h">
      <h3 className="ws-stepgroup-head" id="review-h">Review decisions <span className="ws-tag">Demo only · not saved</span></h3>
      <p className="ws-small ws-muted">
        Applies to: {step ? <strong>{step.title}</strong> : "no open step"}. These buttons change only this page and add a labelled entry to the timeline.
      </p>
      <label className="ws-field">
        <span className="ws-small">Reason or note <span className="ws-muted">(required for an override)</span></span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? "review-err" : undefined} />
      </label>
      {error && <p id="review-err" className="ws-small ws-error-text">{error}</p>}
      <div className="ws-review-actions">
        {ACTIONS.map((a) => (
          <button key={a.id} type="button" className="ws-btn ws-btn-sm" onClick={() => act(a.id)}>{a.label}</button>
        ))}
      </div>
      <p className="ws-visually-hidden" role="status" aria-live="polite">{status}</p>
      {events.length > 0 && (
        <ol className="ws-review-log">
          {events.map((e) => (
            <li key={e.id} className="ws-small">
              <time>{clockTime(e.at)}</time> {REVIEW_ACTION_LABEL[e.action]}{e.reason ? `: ${e.reason}` : ""} <span className="ws-muted">(demo, not saved)</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
