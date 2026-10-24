"use client";

/**
 * Next steps, split by who acts. Only working backend actions are offered (bank record
 * retrieval). Customer questions are asked by the voice assistant on the customer's next call;
 * there is no outbound contact in this prototype, so none is offered.
 */
import { useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RECOMMENDATION_LABEL, STAGE_LABEL, type NextStep, type StoredAnalysis, type Triage } from "@/lib/domain/triage";
import { RefChip } from "./EvidenceRef";
import { AudienceTag } from "./Tags";
import { shortKey } from "./format";
import { useWorkspaceMode } from "./WorkspaceMode";

export function NextSteps({ caseId, triage, analysis, decision, children }: { caseId: Id<"cases">; triage: Triage; analysis: StoredAnalysis | null; decision?: ReactNode; children?: ReactNode }) {
  const bank = triage.steps.filter((s) => s.audience === "reviewer");
  const customer = triage.steps.filter((s) => s.audience === "customer");
  return (
    <aside className="ws-next" aria-labelledby="next-h">
      <h2 id="next-h">Next steps</h2>
      {decision ?? (analysis && (
        <div className="ws-decision">
          <span className="ws-eyebrow">Draft recommendation · {STAGE_LABEL[analysis.stage]}</span>
          <strong>{RECOMMENDATION_LABEL[analysis.recommendation.action]}</strong>
          <p className="ws-small">{analysis.recommendation.rationale}</p>
          <p className="ws-small ws-muted">Rule-based route. <a href="#trace">Decision trace</a></p>
        </div>
      ))}

      <StepGroup title="For the bank" audience="reviewer" steps={bank} caseId={caseId} empty="Nothing for a reviewer right now." />
      <StepGroup
        title="From the customer"
        audience="customer"
        steps={customer}
        caseId={caseId}
        empty="No open questions for the customer."
        note="The voice assistant asks these on the customer's next call. This prototype has no outbound messages."
      />
      {children}
    </aside>
  );
}

function StepGroup({ title, audience, steps, caseId, empty, note }: { title: string; audience: "customer" | "reviewer"; steps: NextStep[]; caseId: Id<"cases">; empty: string; note?: string }) {
  return (
    <section className="ws-stepgroup" aria-label={title}>
      <h3 className="ws-stepgroup-head">
        <AudienceTag audience={audience} /> {title} <span className="ws-count">{steps.length}</span>
      </h3>
      {note && steps.length > 0 && <p className="ws-small ws-muted">{note}</p>}
      {steps.length === 0 ? (
        <p className="ws-small ws-muted">{empty}</p>
      ) : (
        <ol className="ws-steps">
          {steps.map((s) => (
            <li key={s.key} className="ws-step" data-blocking={s.blocking || undefined}>
              <div className="ws-step-title">{audience === "customer" && s.key !== "awaiting_report" ? <>Ask: “{s.title}”</> : s.title}</div>
              <p className="ws-step-why">{s.why}</p>
              <div className="ws-step-foot">
                {s.blocking ? <span className="ws-block"><span aria-hidden="true">■</span> Blocks review</span> : <span className="ws-muted">Non-blocking</span>}
                {s.refs.length > 0 && <span className="ws-step-refs"><span className="ws-muted">Evidence</span> {s.refs.map((r) => <RefChip key={r} refId={r} />)}</span>}
                <code className="ws-key" title={`Stable question key: ${s.key}`}>{shortKey(s.key)}</code>
              </div>
              {s.action === "retrieve_bank_records" && <RetrieveButton caseId={caseId} again={s.key !== "retrieve_bank_records"} primary />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Live, read-only Nessie retrieval through Convex. Failures are recorded and shown, never replaced. */
export function RetrieveButton(props: { caseId: Id<"cases">; again: boolean; primary?: boolean }) {
  if (useWorkspaceMode() === "demo") return <span className="ws-action ws-small ws-muted">Retrieval isn&apos;t available in the demo; its records are fixtures.</span>;
  return <LiveRetrieveButton {...props} />;
}

function LiveRetrieveButton({ caseId, again, primary }: { caseId: Id<"cases">; again: boolean; primary?: boolean }) {
  const retrieve = useAction(api.nessie.retrieveBankEvidence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ws-action">
      <button
        type="button"
        className={`ws-btn${primary ? " ws-btn-primary" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await retrieve({ caseId });
            if (!r.ok) setError(r.error ?? "Retrieval failed");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Retrieving…" : again ? "Retrieve bank records again" : "Retrieve bank records"}
      </button>
      <span className="ws-small ws-muted"> live Nessie call</span>
      {error && <span className="ws-small ws-error-text" role="status"> {error}</span>}
    </span>
  );
}
