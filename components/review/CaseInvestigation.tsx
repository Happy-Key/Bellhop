"use client";

/**
 * The investigation-first view of a case: what happened, the investigative work under way, what is
 * established and what still needs attention. The decision record (evidence, rules, history,
 * documents, activity) is collapsed underneath and opens on demand. View model: lib/review/caseStatus.ts.
 */
import { type ReactNode } from "react";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import type { WorkItem, WorkStatus } from "@/lib/domain/investigation";
import { getSource } from "@/lib/domain/regulatory";
import type { CaseStatus } from "@/lib/review/caseStatus";
import { RefChip } from "./EvidenceRef";
import { ClampedText } from "./CaseSections";
import { exactTime, usd } from "./format";
import type { CaseView, Payment } from "./types";

const WORK_LABEL: Record<WorkStatus, string> = {
  in_progress: "In progress",
  awaiting_customer: "Awaiting the customer",
  awaiting_bank: "Awaiting the bank",
  done: "Done",
  not_needed: "Not needed",
};

const HYPOTHESIS_LABEL = { open: "Testing", supported: "Supported", ruled_out: "Ruled out" } as const;
const READING_LABEL = { likely_applies: "Likely applies", likely_does_not_apply: "Likely doesn't apply", unclear: "Unclear" } as const;

export function SourceBadge({ status }: { status: CaseStatus }) {
  return <span className={`ws-tag ${status.source === "model" ? "ws-tag-live" : "ws-tag-rules"}`}>{status.sourceLabel}</span>;
}

// ---------- What happened ----------

export function CaseOverview({ data, status, payment, noPayment }: { data: CaseView; status: CaseStatus; payment: Payment | null; noPayment: string }) {
  const first = data.statements[0];
  return (
    <section id="overview" className="ws-section ws-overview" aria-labelledby="overview-h">
      <div className="ws-overview-head">
        <h2 id="overview-h">What happened</h2>
        <SourceBadge status={status} />
      </div>
      {status.summary ? (
        <p className="ws-overview-summary">{status.summary}</p>
      ) : first ? (
        <blockquote className="ws-quote">
          <ClampedText text={first.text} />
          <footer><RefChip refId={first.ref} /> · the customer&apos;s own words · {first.channel}</footer>
        </blockquote>
      ) : (
        <p className="ws-muted">No report yet.</p>
      )}
      <dl className="ws-keyfacts">
        <div>
          <dt>Payment</dt>
          <dd>
            {payment ? (
              <>{usd(payment.amount)} · {payment.merchant ?? "Unknown merchant"} · {payment.date ?? "date unknown"} <RefChip refId={payment.ref} />{!payment.matched && <span className="ws-muted"> (candidate)</span>}</>
            ) : (
              <span className="ws-muted">Not identified yet. {noPayment}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Reported</dt>
          <dd>{first ? exactTime(first.receivedAt) : <span className="ws-muted">—</span>}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd><strong>{status.statusLabel}</strong></dd>
        </div>
      </dl>
      {status.blockers.length > 0 && (
        <ul className="ws-blockers" aria-label="Blocking issues">
          {status.blockers.map((b) => <li key={b}><span className="ws-block"><span aria-hidden="true">■</span> Blocking</span> {b}</li>)}
        </ul>
      )}
    </section>
  );
}

// ---------- Investigation ----------

export function InvestigationBoard({ status, reassessing, problem }: { status: CaseStatus; reassessing: boolean; problem: string | null }) {
  const active = status.work.filter((w) => w.status !== "done" && w.status !== "not_needed");
  const done = status.work.filter((w) => w.status === "done");
  return (
    <section id="work" className="ws-section" aria-labelledby="work-h">
      <div className="ws-section-head ws-row-head">
        <h2 id="work-h">Investigation</h2>
        {reassessing && <span className="ws-tag ws-tag-live ws-pulse" role="status">Reassessing…</span>}
      </div>
      {problem && <p className="ws-small ws-error-text" role="status">Latest model assessment not used: {problem}. {status.source === "model" ? "The previous assessment is shown." : "The rule-based fallback is shown."}</p>}
      {status.work.length === 0 ? (
        <p className="ws-muted ws-small">No investigative work yet.</p>
      ) : (
        <>
          <ol className="ws-work">
            {active.map((w) => <WorkRow key={w.key} w={w} />)}
          </ol>
          {done.length > 0 && (
            <ol className="ws-work ws-work-done" aria-label="Completed">
              {done.map((w) => <WorkRow key={w.key} w={w} />)}
            </ol>
          )}
        </>
      )}
      {status.source === "rules" && <p className="ws-small ws-muted">Rule-based fallback: it only covers the work the fixed rules know about. The reasoning model plans the investigation when it is on.</p>}
    </section>
  );
}

function WorkRow({ w }: { w: WorkItem }) {
  const done = w.status === "done";
  return (
    <li className="ws-workitem" data-status={w.status}>
      <span className="ws-work-mark" aria-hidden="true" />
      <div>
        <div className="ws-work-title">
          <strong>{done ? (w.doneTitle ?? w.title) : w.title}</strong>
          {!done && <span className={`ws-wstate ws-wstate-${w.status}`}>{WORK_LABEL[w.status]}</span>}
        </div>
        <p className="ws-small ws-muted">{done ? (w.outcome ?? w.detail) : w.detail} {[...new Set(w.refs)].map((r) => <RefChip key={r} refId={r} />)}</p>
      </div>
    </li>
  );
}

// ---------- Established and open ----------

export function FindingsAndGaps({ status }: { status: CaseStatus }) {
  const inv = status.investigation;
  const uncertain = [...inv.uncertainties].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <section id="findings" className="ws-section" aria-labelledby="findings-h">
      <div className="ws-section-head"><h2 id="findings-h">Established and open</h2></div>
      <div className="ws-fgrid ws-fgrid-2">
        <div>
          <h3 className="ws-fgroup-head">Findings <span className="ws-count">{inv.findings.length}</span></h3>
          {inv.findings.length === 0 ? <p className="ws-small ws-muted">Nothing established yet.</p> : (
            <ul className="ws-flist">
              {inv.findings.map((f, i) => (
                <li key={`${i}-${f.text}`} className="ws-finding2">
                  <span className={`ws-basis ws-basis-${f.basis}`}>{f.basis === "corroborated" ? "Corroborated" : "Reported"}</span> {f.text} {[...new Set(f.refs)].filter((r) => !r.startsWith("R:")).map((r) => <RefChip key={r} refId={r} />)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="ws-fgroup-head">Needs attention <span className="ws-count">{uncertain.length}</span></h3>
          {uncertain.length === 0 ? <p className="ws-small ws-muted">No material uncertainties.</p> : (
            <ul className="ws-flist">
              {uncertain.map((u, i) => (
                <li key={`${i}-${u.text}`} className="ws-finding2">{u.blocking && <span className="ws-block"><span aria-hidden="true">■</span> Blocking</span>} {u.text}</li>
              ))}
            </ul>
          )}
          {inv.hypotheses.length > 0 && (
            <>
              <h3 className="ws-fgroup-head ws-mt">Working hypotheses</h3>
              <ul className="ws-flist">
                {inv.hypotheses.map((h, i) => (
                  <li key={`${i}-${h.text}`} className="ws-finding2" data-ruled-out={h.status === "ruled_out" || undefined}>
                    <span className={`ws-hyp ws-hyp-${h.status}`}>{HYPOTHESIS_LABEL[h.status]}</span> {h.text} {[...new Set(h.refs)].filter((r) => !r.startsWith("R:")).map((r) => <RefChip key={r} refId={r} />)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <p className="ws-small ws-muted">Reported = the customer&apos;s word. Corroborated = backed by a bank record or provider fact. Hypotheses are interpretations being tested, not findings.</p>
    </section>
  );
}

// ---------- Decision record ----------

export interface RecordPart {
  id: string;
  title: string;
  count?: number;
  body: ReactNode;
}

/** The evidence-linked decision record: everything behind the conclusion, collapsed by default. */
export function DecisionRecord({ parts }: { parts: RecordPart[] }) {
  return (
    <section id="record" className="ws-section ws-record" aria-labelledby="record-h">
      <div className="ws-section-head">
        <h2 id="record-h">Decision record</h2>
        <p className="ws-small ws-muted">Everything behind the assessment, for inspection and audit. Evidence links open the section that holds the source.</p>
      </div>
      {parts.map((p) => (
        <details key={p.id} id={`rec-${p.id}`} className="ws-recpart">
          <summary>{p.title}{p.count !== undefined && <span className="ws-count">{p.count}</span>}</summary>
          <div className="ws-recbody">{p.body}</div>
        </details>
      ))}
    </section>
  );
}

/** The model's reading of the curated rules, with source versions. */
export function RulesConsidered({ proposal }: { proposal: CaseProposal | null }) {
  if (!proposal || proposal.legalBasis.length === 0) return <p className="ws-small ws-muted">The reasoning model hasn&apos;t assessed the rules for this case. The rule-based trace is below.</p>;
  return (
    <ul className="ws-trace-list">
      {proposal.legalBasis.map((l, i) => {
        const s = getSource(l.sourceRef);
        return (
          <li key={`${i}-${l.sourceRef}`}>
            <span className={`ws-reading ws-reading-${l.reading}`}>{READING_LABEL[l.reading]}</span> <strong>{s?.citation ?? l.sourceRef}</strong> — {l.note}
            {s && <div className="ws-small ws-muted">Source reviewed {s.reviewedOn}{s.verbatimVerified ? "" : " · excerpt paraphrased"} · {s.kind.replace(/_/g, " ")}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export interface HistoryRow {
  _id: string;
  completedAt: number;
  provider: string | null;
  decision: string | null;
  changeLog: { kind: string; text: string }[];
  resolution: { accepted: boolean; note: string; at: number } | null;
}

/** Every accepted assessment, newest first, with what changed (computed by code) and the model's reasons. */
export function AssessmentHistory({ history, reasons }: { history: HistoryRow[]; reasons: { text: string; refs: string[] }[] }) {
  if (history.length === 0) return <p className="ws-small ws-muted">No model assessments yet.</p>;
  return (
    <ol className="ws-history">
      {history.map((h, i) => (
        <li key={h._id}>
          <div className="ws-small"><strong>{exactTime(h.completedAt)}</strong> · {h.provider?.split(":")[0] ?? "model"} · next step: {h.decision?.replace(/_/g, " ") ?? "—"}{h.resolution && <> · {h.resolution.accepted ? "accepted" : "rejected"} by a person</>}</div>
          {h.changeLog.length > 0 ? (
            <ul className="ws-small">{h.changeLog.map((c, j) => <li key={j}>{c.text}</li>)}</ul>
          ) : (
            <p className="ws-small ws-muted">{i === history.length - 1 ? "First assessment." : "No material change."}</p>
          )}
          {i === 0 && reasons.length > 0 && (
            <div className="ws-small"><span className="ws-eyebrow">Model&apos;s reasons for the change</span>
              <ul>{reasons.map((r, j) => <li key={j}>{r.text} {[...new Set(r.refs)].filter((x) => !x.startsWith("R:")).map((x) => <RefChip key={x} refId={x} />)}</li>)}</ul>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export function ModelDocuments({ proposal }: { proposal: CaseProposal | null }) {
  if (!proposal || proposal.documents.length === 0) return null;
  return (
    <div className="ws-drafts">
      {proposal.documents.map((d, i) => (
        <details key={`${i}-${d.kind}`} className="ws-details">
          <summary>{d.kind.replace(/_/g, " ")} <span className="ws-muted ws-small">· drafted by the model, not sent</span></summary>
          <p className="ws-prewrap ws-small">{d.text}</p>
        </details>
      ))}
    </div>
  );
}
