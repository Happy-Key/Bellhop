"use client";

/**
 * Case brief, findings and open questions, decision trace, and prepared outputs. Display only:
 * the content comes from the stored analysis through lib/review/workspace.ts.
 */
import type { StoredAnalysis, Triage } from "@/lib/domain/triage";
import { RECOMMENDATION_LABEL, STAGE_LABEL } from "@/lib/domain/triage";
import {
  OUTPUT_STATE_LABEL,
  RECONCILIATION_LABEL,
  RULE_ASSUMPTIONS,
  SOURCE_KIND_LABEL,
  decisionTrace,
  groupFindings,
  preparedOutputs,
  reconciliation,
  type FindingItem,
} from "@/lib/review/workspace";
import { useState } from "react";
import { goToRef, RefChip } from "./EvidenceRef";
import { AudienceTag, KindTag } from "./Tags";
import { ClampedText } from "./CaseSections";
import { CREDENTIALS_LABEL, POSITION_LABEL, exactTime, humanize, usd } from "./format";
import type { CaseView, Payment } from "./types";
import { useWorkspaceMode } from "./WorkspaceMode";

// ---------- Case brief ----------

export function CaseBrief({ data, analysis, triage, payment }: { data: CaseView; analysis: StoredAnalysis | null; triage: Triage; payment: Payment | null }) {
  const mode = useWorkspaceMode();
  const first = data.statements[0];
  const facts = analysis?.facts;
  const rec = payment ? reconciliation(analysis, payment.ref) : null;
  const blocker = triage.steps.find((s) => s.blocking) ?? null;
  const next = triage.lead;
  const reported = facts
    ? [
        ...facts.amounts.map((a) => ({ text: usd(a.value), ref: a.statementRef })),
        ...facts.merchantTerms.map((m) => ({ text: `payee “${m.value}”`, ref: m.statementRef })),
        ...facts.dates.map((d) => ({ text: d.value, ref: d.statementRef })),
      ]
    : [];
  return (
    <section id="brief" className="ws-section" aria-labelledby="brief-h">
      <div className="ws-section-head">
        <h2 id="brief-h">Case brief</h2>
        <p className="ws-muted ws-small">
          Assembled from the stored analysis{mode === "demo" ? " of the scripted demo inputs" : ""}. It is not a generated narrative; every line links to its evidence.
        </p>
      </div>
      {first ? (
        <blockquote className="ws-quote">
          <ClampedText text={first.text} />
          <footer>
            <RefChip refId={first.ref} /> · {first.channel} · report received <strong>{exactTime(first.receivedAt)}</strong>
          </footer>
        </blockquote>
      ) : (
        <p className="ws-muted">No report yet. The case was opened {exactTime(data.case.createdAt)}.</p>
      )}

      <dl className="ws-brief">
        <dt><KindTag kind="reported" /></dt>
        <dd>
          {!facts?.authorization && reported.length === 0 && facts?.scamIndicators.length === 0 ? (
            <span className="ws-muted">Nothing reported yet.</span>
          ) : (
            <>
              {facts?.authorization && <span className="ws-brief-item">{POSITION_LABEL[facts.authorization.value]} <RefChip refId={facts.authorization.statementRef} /></span>}
              {facts?.credentialSharing && <span className="ws-brief-item">{CREDENTIALS_LABEL[facts.credentialSharing.value]} <RefChip refId={facts.credentialSharing.statementRef} /></span>}
              {reported.length > 0 && (
                <span className="ws-brief-item">
                  Payment described as {reported.map((r, i) => <span key={`${r.ref}-${r.text}`}>{i > 0 && ", "}{r.text} <RefChip refId={r.ref} /></span>)}
                </span>
              )}
              {facts && facts.scamIndicators.length > 0 && (
                <span className="ws-brief-item">Mentions {facts.scamIndicators.map((s) => <span key={`${s.statementRef}-${s.value}`}>“{s.value}” <RefChip refId={s.statementRef} /></span>)}</span>
              )}
            </>
          )}
        </dd>
        <dt><KindTag kind="observed" /></dt>
        <dd>
          {payment ? (
            <span className="ws-brief-item">
              {payment.matched ? "Bank record" : "Candidate record"} {usd(payment.amount)} · {payment.merchant ?? "unknown payee"} · {payment.date ?? "date unknown"} · status {payment.status ?? "unknown"} <RefChip refId={payment.ref} />
            </span>
          ) : (
            <span className="ws-muted">No bank record is linked to the report yet.</span>
          )}
        </dd>
        <dt><KindTag kind="inferred" /></dt>
        <dd>
          <span className="ws-brief-item">Stage: {STAGE_LABEL[analysis?.stage ?? "intake"]}</span>
          {rec && payment && (
            <span className="ws-brief-item">
              {RECONCILIATION_LABEL[rec.state]} {rec.confirmedBy && <>(customer confirmed in <RefChip refId={rec.confirmedBy} />)</>}
            </span>
          )}
          {facts && facts.conflicts.length > 0 && <span className="ws-brief-item ws-warn-text">⚠ Statements disagree on {facts.conflicts.map((c) => humanize(c.field)).join(", ")}</span>}
          <span className="ws-small ws-muted">Rule-based, not a model.</span>
        </dd>
        <dt><KindTag kind="recommended" /></dt>
        <dd>
          {analysis ? (
            <span className="ws-brief-item">
              Draft route: <strong>{RECOMMENDATION_LABEL[analysis.recommendation.action]}</strong> · <a href="#trace">decision trace</a>
            </span>
          ) : (
            <span className="ws-muted">No draft route yet.</span>
          )}
          {next && <span className="ws-brief-item">Proposed next action: {triage.headline}</span>}
        </dd>
        <dt className="ws-brief-blocker">Key blocker</dt>
        <dd>{blocker ? <>{blocker.audience === "customer" && blocker.key !== "awaiting_report" ? "Customer to answer: " : ""}{blocker.title} <span className="ws-muted ws-small">— {blocker.why}</span></> : <span className="ws-muted">None. Nothing blocks review.</span>}</dd>
      </dl>
    </section>
  );
}

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
