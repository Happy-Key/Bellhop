"use client";

/**
 * The rule-based guardrail's view of a case: its findings and open questions, decision trace, and
 * prepared outputs. Shown inside the decision record. Display only: the content comes from the
 * stored analysis through lib/review/workspace.ts.
 */
import type { StoredAnalysis, Triage } from "@/lib/domain/triage";
import { RECOMMENDATION_LABEL, STAGE_LABEL } from "@/lib/domain/triage";
import {
  OUTPUT_STATE_LABEL,
  RULE_ASSUMPTIONS,
  SOURCE_KIND_LABEL,
  decisionTrace,
  groupFindings,
  preparedOutputs,
  type FindingItem,
} from "@/lib/review/workspace";
import { useState } from "react";
import { goToRef, RefChip } from "./EvidenceRef";
import { AudienceTag, KindTag } from "./Tags";
import type { CaseView } from "./types";

// ---------- Findings and open questions ----------

function FindingRow({ f }: { f: FindingItem }) {
  return (
    <li className="ws-finding" onClick={(e) => { if (f.refs[0] && !(e.target as HTMLElement).closest("button")) goToRef(f.refs[0]); }}>
      <div className="ws-finding-head">
        {f.audience ? <AudienceTag audience={f.audience} /> : <KindTag kind={f.kind} />}
        {f.blocking !== undefined && (f.blocking ? <span className="ws-block"><span aria-hidden="true">■</span> Blocking</span> : <span className="ws-muted ws-small">Non-blocking</span>)}
        {f.status && f.status !== "unverified" && <span className="ws-tag">{f.status}</span>}
      </div>
      <p>{f.text} {f.refs.map((r) => <RefChip key={r} refId={r} />)}</p>
      {f.detail && <p className="ws-small ws-warn-text">{f.detail}</p>}
    </li>
  );
}

export function FindingsPanel({ data, analysis }: { data: CaseView; analysis: StoredAnalysis | null }) {
  const g = groupFindings(data, analysis);
  const group = (id: string, title: string, items: FindingItem[], empty: string, note?: string) => (
    <div className="ws-fgroup" aria-labelledby={`fg-${id}`}>
      <h3 className="ws-fgroup-head" id={`fg-${id}`}>{title} <span className="ws-count">{items.length}</span></h3>
      {note && <p className="ws-small ws-muted">{note}</p>}
      {items.length === 0 ? <p className="ws-small ws-muted">{empty}</p> : <ul className="ws-flist">{items.map((f) => <FindingRow key={f.id} f={f} />)}</ul>}
    </div>
  );
  return (
    <section id="findings" className="ws-section" aria-labelledby="findings-h">
      <div className="ws-section-head">
        <h2 id="findings-h">Findings and open questions</h2>
        <p className="ws-muted ws-small">Every finding cites its evidence and passed validation. Select one to jump to its source. No confidence scores or fraud scores are computed.</p>
      </div>
      <div className="ws-fgrid">
        {group("supported", "Supported by evidence", g.supported, "Nothing established yet.", "Customer statements stay “reported”, even when supported by a record.")}
        {group("missing", "Missing", g.missing, "Nothing missing.", "Missing information is not evidence against the customer.")}
        {group("conflicting", "Conflicting", g.conflicting, "No conflicts.")}
      </div>
      <details className="ws-details">
        <summary>Superseded ({g.superseded.length}) — corrections and earlier record versions, kept for history</summary>
        {g.superseded.length === 0 ? <p className="ws-small ws-muted">Nothing has been superseded.</p> : <ul className="ws-flist">{g.superseded.map((f) => <FindingRow key={f.id} f={f} />)}</ul>}
      </details>
      {g.rejectedCount > 0 && <p className="ws-small ws-error-text">{g.rejectedCount} proposed finding(s) failed validation and are not used.</p>}
    </section>
  );
}

// ---------- Decision trace ----------

const CONDITION_LABEL: Record<string, string> = {
  supported_by_customer_statement: "Reported by customer",
  supported_by_record: "Shown by record",
  contradicted: "Contradicted",
  unresolved: "Unresolved",
};

export function DecisionTrace({ data, analysis, triage }: { data: CaseView; analysis: StoredAnalysis | null; triage: Triage }) {
  if (!analysis) return null;
  const t = decisionTrace(data, analysis);
  const next = triage.lead;
  return (
    <section id="trace" className="ws-section" aria-labelledby="trace-h">
      <div className="ws-section-head">
        <h2 id="trace-h">Decision trace</h2>
        <p className="ws-muted ws-small">What the draft route rests on. It comes from fixed rules (lib/domain/workflow.ts), not from a model and not from hidden reasoning. It is not a legal determination.</p>
      </div>
      <div className="ws-decision">
        <span className="ws-eyebrow">Draft route · {STAGE_LABEL[analysis.stage]}</span>
        <strong>{RECOMMENDATION_LABEL[analysis.recommendation.action]}</strong>
        <p className="ws-small">{analysis.recommendation.rationale}</p>
      </div>

      <h3 className="ws-h3">Facts used</h3>
      {t.factsUsed.length === 0 ? <p className="ws-small ws-muted">No supported facts yet.</p> : (
        <ul className="ws-trace-list">
          {t.factsUsed.map((f) => <li key={f.id}><KindTag kind={f.kind} /> {f.text} {f.refs.map((r) => <RefChip key={r} refId={r} />)}</li>)}
        </ul>
      )}

      <h3 className="ws-h3">Rules and sources</h3>
      <p className="ws-small ws-muted">Curated sources the rules marked as possibly relevant. No card-network procedures are encoded in this prototype.</p>
      {t.sources.length === 0 && <p className="ws-small ws-muted">None for the current facts.</p>}
      {t.sources.map((s) => (
        <details key={s.ref} className="ws-details ws-consideration">
          <summary>
            <strong>{s.citation}</strong> <span className="ws-tag">{SOURCE_KIND_LABEL[s.kind]}{s.synthetic ? " · synthetic demo" : ""}</span>
            <span className="ws-muted ws-small"> — {s.relevance}</span>
          </summary>
          {!s.verbatimVerified && <p className="ws-small ws-warn-text">Excerpt paraphrased; verify against the source before citing.</p>}
          <ul className="ws-conditions">
            {s.conditions.map((k) => (
              <li key={k.text}>
                <span className={`ws-tag ws-cond-${k.status}`}>{CONDITION_LABEL[k.status]}</span> {k.text} {k.refs.map((r) => <RefChip key={r} refId={r} />)}
              </li>
            ))}
          </ul>
          {s.url && <p className="ws-small"><a href={s.url} target="_blank" rel="noreferrer">Official source</a></p>}
        </details>
      ))}

      <h3 className="ws-h3">Assumptions</h3>
      <ul className="ws-trace-list ws-small">{RULE_ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}</ul>

      <h3 className="ws-h3">Unresolved</h3>
      {t.unresolved.length === 0 && t.blocking.length === 0 ? <p className="ws-small ws-muted">Nothing unresolved.</p> : (
        <ul className="ws-trace-list ws-small">
          {t.blocking.map((b) => <li key={b.key}><span className="ws-block"><span aria-hidden="true">■</span> Blocking</span> <AudienceTag audience={b.audience} /> {b.text}</li>)}
          {t.unresolved.map((u) => <li key={u.text}>{u.text} {u.refs.map((r) => <RefChip key={r} refId={r} />)}</li>)}
        </ul>
      )}

      {next && (
        <p className="ws-small"><span className="ws-eyebrow">Proposed next action</span> {triage.headline}</p>
      )}
    </section>
  );
}

// ---------- Prepared outputs ----------

export function PreparedOutputs({ analysis }: { analysis: StoredAnalysis | null }) {
  const outputs = preparedOutputs(analysis);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section id="outputs" className="ws-section" aria-labelledby="outputs-h">
      <div className="ws-section-head">
        <h2 id="outputs-h">Prepared outputs</h2>
        <p className="ws-muted ws-small">Drafts for a person to review. Nothing here is sent, filed or downloadable, and no notice is presented as compliant.</p>
      </div>
      <ul className="ws-outputs">
        {outputs.map((o) => (
          <li key={o.id} className="ws-output" data-state={o.state}>
            <div className="ws-output-head">
              <strong>{o.title}</strong>
              <span className="ws-muted ws-small">{o.audience}</span>
              <span className={`ws-ostate ws-ostate-${o.state}`}>{OUTPUT_STATE_LABEL[o.state]}</span>
              {o.preview && <span className="ws-tag">Preview</span>}
            </div>
            <p className="ws-small ws-muted">{o.reason}</p>
            {o.body.length > 0 && (
              <>
                <button type="button" className="ws-link" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
                  {open === o.id ? "Hide draft" : "Show draft"}
                </button>
                {open === o.id && (
                  <div className="ws-draft">
                    {o.preview && <p className="ws-small ws-warn-text">Preview assembled in the browser from stored questions. No approved template; not a production document.</p>}
                    <ul>{o.body.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
