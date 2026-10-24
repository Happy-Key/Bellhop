"use client";

/**
 * Synthetic guided-intake walkthrough. Step through a scripted scenario; each step recomputes the
 * case from fixed fixture inputs with the app's own rules (lib/review/demoCase.ts) and renders it
 * in the normal case workspace with mode "demo". Nothing is fetched, saved, or sent.
 */
import { useMemo, useState } from "react";
import { DEMO_BRANCHES, DEMO_FORK_INDEX, DEMO_START, type DemoBranch } from "@/lib/fixtures/guidedIntakeDemo";
import { buildDemoState } from "@/lib/review/demoCase";
import type { DemoReviewEvent } from "@/lib/review/types";
import { CaseWorkspace } from "./CaseReview";
import { DemoReviewControls } from "./ReviewControls";

export function DemoWorkspace() {
  const [branch, setBranch] = useState<DemoBranch>("other_person");
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState<DemoReviewEvent[]>([]);
  const state = useMemo(() => buildDemoState(branch, step), [branch, step]);
  const beats = state.beats;
  const beat = beats[state.step]!;
  const last = beats.length - 1;

  const go = (n: number) => setStep(Math.max(0, Math.min(last, n)));
  const reset = () => {
    setStep(0);
    setBranch("other_person");
    setEvents([]);
  };
  const choose = (b: DemoBranch) => {
    if (b === branch) return;
    setBranch(b);
    setEvents([]);
  };

  const banner = (
    <section className="ws-demo" aria-labelledby="demo-h">
      <div className="ws-demo-head">
        <div>
          <h2 id="demo-h">Synthetic demo — scripted scenario</h2>
          <p className="ws-small">
            Fixed fixture inputs, run through the app&apos;s own rule-based workflow in your browser. No AI service, Convex or Nessie call is made, nothing is saved, and the
            “agent” questions are the ones the rules select. This is separate from the live claims in the queue.
          </p>
        </div>
        <div className="ws-demo-nav">
          <button type="button" className="ws-btn" onClick={() => go(state.step - 1)} disabled={state.step === 0}>← Back</button>
          <button type="button" className="ws-btn ws-btn-primary" onClick={() => go(state.step + 1)} disabled={state.step === last}>Next step →</button>
          <button type="button" className="ws-btn" onClick={reset}>Reset</button>
        </div>
      </div>

      <ol className="ws-demo-steps" aria-label="Scenario steps">
        {beats.map((b, i) => (
          <li key={`${branch}-${b.id}`}>
            <button type="button" aria-current={i === state.step ? "step" : undefined} data-done={i < state.step || undefined} onClick={() => go(i)}>
              <span className="ws-demo-num">{i + 1}</span> {b.title}
            </button>
          </li>
        ))}
      </ol>

      <div className="ws-demo-branch" role="radiogroup" aria-label={`Customer's answer at step ${DEMO_FORK_INDEX + 1}: who entered and sent the payment`}>
        <span className="ws-small ws-muted">Branch from step {DEMO_FORK_INDEX + 1}:</span>
        {DEMO_BRANCHES.map((b) => (
          <label key={b.id} className="ws-radio">
            <input type="radio" name="demo-branch" checked={branch === b.id} onChange={() => choose(b.id)} /> {b.label}
          </label>
        ))}
      </div>

      <div className="ws-demo-narration" aria-live="polite">
        <p>
          <strong>Step {state.step + 1} of {beats.length}: {beat.title}.</strong> {beat.narration}
        </p>
      </div>
    </section>
  );

  return (
    <CaseWorkspace
      data={state.view}
      mode="demo"
      snapshots={state.snapshots}
      reviewEvents={events}
      banner={banner}
      review={(triage) => (
        <DemoReviewControls
          step={triage.lead}
          events={events}
          onAction={(action, reason) =>
            setEvents((prev) => [
              ...prev,
              // Demo clock: after the last scripted reply, one minute apart.
              { id: `${prev.length + 1}`, at: DEMO_START + (200 + prev.length * 60) * 1000, action, reason, stepKey: triage.lead?.key ?? null },
            ])
          }
        />
      )}
    />
  );
}

