"use client";

/** Centre-column sections of the case review workspace. Display only, apart from bank retrieval. */
import { useEffect, useRef, useState } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { StoredAnalysis } from "@/lib/domain/triage";
import { RECOMMENDATION_LABEL } from "@/lib/domain/triage";
import { getSource } from "@/lib/domain/regulatory";
import { RefChip, refAnchor, useIsActive } from "./EvidenceRef";
import { RetrieveButton } from "./NextSteps";
import { clockTime, exactTime, FIELD_LABEL, humanize, POSITION_LABEL, shortKey, shortRef, shortTime, usd } from "./format";
import type { CaseView } from "./types";

const ANSWER_LABEL: Record<string, string> = {
  answered: "Answered",
  unknown: "Customer didn't know",
  declined: "Customer declined",
  unparsed: "Reply didn't settle it",
};

/** Anchor target for a piece of evidence: highlighted while a chip for its ref is active. */
function useAnchor(ref: string) {
  return { id: refAnchor(ref), tabIndex: -1, "data-on": useIsActive(ref) || undefined };
}

export function ReportSummary({ data, analysis }: { data: CaseView; analysis: StoredAnalysis | null }) {
  const first = data.statements[0];
  return (
    <section id="summary" className="ws-section" aria-labelledby="summary-h">
      <h2 id="summary-h">Customer report</h2>
      {!first ? (
        <p className="ws-muted">No statement has been recorded yet. The case was opened {exactTime(data.case.createdAt)}.</p>
      ) : (
        <>
          <blockquote className="ws-quote">
            <ClampedText text={first.text} />
            <footer>
              <RefChip refId={first.ref} /> · {first.channel} · {exactTime(first.receivedAt)}
              {data.statements.length > 1 && <> · {data.statements.length - 1} later statement{data.statements.length > 2 ? "s" : ""} below</>}
            </footer>
          </blockquote>
          {analysis?.facts.authorization && (
            <p>
              <span className="ws-eyebrow">Customer position (reported)</span> {POSITION_LABEL[analysis.facts.authorization.value]} <RefChip refId={analysis.facts.authorization.statementRef} />
            </p>
          )}
        </>
      )}
      {analysis && (
        <ul className="ws-bullets">
          {analysis.packet.summary.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </section>
  );
}

function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // Offer the toggle only when the clamped text is actually cut off at the current width.
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={ref} className={open ? undefined : "ws-clamp-6"}>“{text}”</p>
      {(overflows || open) && (
        <button type="button" className="ws-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show full statement"}
        </button>
      )}
    </>
  );
}

export function Statements({ data, analysis }: { data: CaseView; analysis: StoredAnalysis | null }) {
  const supersededBy = new Map((analysis?.facts.superseded ?? []).map((s) => [s.ref, s]));
  return (
    <section id="statements" className="ws-section" aria-labelledby="statements-h">
      <div className="ws-section-head">
        <h2 id="statements-h">Statements <span className="ws-count">{data.statements.length}</span></h2>
        <p className="ws-muted ws-small">Customer-reported and unverified. Stored after sensitive values are removed; never edited.</p>
      </div>
      {data.statements.length === 0 && <p className="ws-muted">None yet.</p>}
      <ol className="ws-statements">
        {data.statements.map((s) => (
          <StatementCard key={s._id} s={s} superseded={supersededBy.get(s.ref)} />
        ))}
      </ol>
    </section>
  );
}

function StatementCard({ s, superseded }: { s: Doc<"statements">; superseded?: { by: string; fields: string[] } }) {
  const anchor = useAnchor(s.ref);
  const i = s.interpretation;
  return (
    <li className="ws-stmt" {...anchor}>
      <div className="ws-stmt-head">
        <span className="ws-stmt-ref">{s.ref}</span>
        <span className="ws-tag">{s.channel}</span>
        <time dateTime={new Date(s.receivedAt).toISOString()} title={exactTime(s.receivedAt)}>{clockTime(s.receivedAt)}</time>
        {s.correctsRef && <span className="ws-small">corrects <RefChip refId={s.correctsRef} /></span>}
        {superseded && (
          <span className="ws-small ws-muted">
            {superseded.fields.map((f) => FIELD_LABEL[f] ?? humanize(f)).join(", ")} superseded by <RefChip refId={superseded.by} />
          </span>
        )}
      </div>
      {s.inResponseTo && (
        <div className="ws-reply">
          <span className="ws-eyebrow">In reply to</span> “{s.inResponseTo.text}” <code className="ws-key" title={`Stable question key: ${s.inResponseTo.key}`}>{shortKey(s.inResponseTo.key)}</code>
          {s.answer && (
            <span className={`ws-answer ws-answer-${s.answer.state}`}>
              {ANSWER_LABEL[s.answer.state]}
              {s.answer.derived?.confirmsTxnRef && <> · confirms <RefChip refId={s.answer.derived.confirmsTxnRef} /></>}
              {s.answer.derived?.rejectsTxnRef && <> · rejects <RefChip refId={s.answer.derived.rejectsTxnRef} /></>}
            </span>
          )}
        </div>
      )}
      <div className="ws-stmt-text"><ClampedText text={s.text} /></div>
      {s.redactions && s.redactions.length > 0 && <p className="ws-small ws-muted">Removed before storage: {s.redactions.map(humanize).join(", ")} (values never kept).</p>}
      {s.interpretationStatus === "pending" && <p className="ws-small ws-muted">Interpretation pending…</p>}
      {s.interpretationStatus === "failed" && (
        <p className="ws-small ws-error-text">Interpretation failed: {s.interpretationError}. Not interpreted; retry from the developer console.</p>
      )}
      {i && (
        <dl className="ws-extract">
          <dt>Read by</dt>
          <dd><span className={`ws-tag ${i.mode === "live" ? "ws-tag-live" : ""}`}>{i.mode === "live" ? `model · ${i.provider}` : "scripted rules"}</span></dd>
          {i.amounts.length > 0 && (<><dt>Amounts</dt><dd>{i.amounts.map(usd).join(", ")}</dd></>)}
          {i.dates.length > 0 && (<><dt>Dates</dt><dd>{i.dates.join(", ")}</dd></>)}
          {i.merchantTerms.length > 0 && (<><dt>Payee terms</dt><dd>{i.merchantTerms.join(", ")}</dd></>)}
          {i.authorization !== "unspecified" && (<><dt>Position</dt><dd>{POSITION_LABEL[i.authorization]}</dd></>)}
          {i.scamIndicators.length > 0 && (<><dt>Scam signs</dt><dd>{i.scamIndicators.join(", ")}</dd></>)}
        </dl>
      )}
    </li>
  );
}

export function BankRecords({ data, analysis, focusedRef }: { data: CaseView; analysis: StoredAnalysis | null; focusedRef: string | null }) {
  const bf = data.case.bankFetch;
  const match = analysis?.match;
  const candidates = new Set(match?.candidates.map((c) => c.txnRef) ?? []);
  const excluded = new Map(match?.excluded.map((x) => [x.txnRef, x.reason]) ?? []);
  const historyCount = data.history.transactions.length;
  return (
    <section id="records" className="ws-section" aria-labelledby="records-h">
      <div className="ws-section-head">
        <h2 id="records-h">Bank records <span className="ws-count">{data.transactions.length}</span></h2>
        <p className="ws-muted ws-small">Capital One Nessie sandbox (live API, synthetic account). Retrieval is read-only.</p>
      </div>
      <div className="ws-fetch">
        {bf.status === "never" && <span>Not retrieved yet.</span>}
        {bf.status === "ok" && <span>Retrieved {bf.count} record{bf.count === 1 ? "" : "s"} · {exactTime(bf.at)}</span>}
        {bf.status === "error" && <span className="ws-error-text" role="status">Retrieval failed: {bf.error}. No sample data was substituted.</span>}
        <RetrieveButton caseId={data.case._id} again={bf.status !== "never"} />
      </div>
      {!data.case.nessieAccountBound && <p className="ws-small ws-warn-text">No demo account is bound yet; the backend binds the configured account on first retrieval.</p>}
      {data.transactions.length > 0 && (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Date</th>
                <th scope="col" className="ws-num">Amount</th>
                <th scope="col">Payee</th>
                <th scope="col">Status</th>
                <th scope="col">Matcher</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <TxnRow
                  key={t._id}
                  t={t}
                  focused={t.ref === focusedRef}
                  verdict={t.ref === match?.matchedRef ? "Matched" : candidates.has(t.ref) ? "Candidate" : excluded.has(t.ref) ? `Excluded: ${excluded.get(t.ref)}` : ""}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historyCount > 0 && (
        <details className="ws-details">
          <summary>{historyCount} earlier record version{historyCount === 1 ? "" : "s"} (superseded, kept for history)</summary>
          <table className="ws-table ws-table-muted">
            <tbody>
              {data.history.transactions.map((t) => (
                <tr key={t._id}>
                  <td><code title={t.ref}>{shortRef(t.ref)}</code></td>
                  <td className="ws-nowrap">{t.date ?? "—"}</td>
                  <td className="ws-num">{usd(t.amount)}</td>
                  <td>{t.status ?? "—"}</td>
                  <td>superseded {t.supersededAt ? shortTime(t.supersededAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function TxnRow({ t, focused, verdict }: { t: Doc<"transactions">; focused: boolean; verdict: string }) {
  const anchor = useAnchor(t.ref);
  return (
    <tr {...anchor} data-focused={focused || undefined}>
      <td><code title={t.ref}>{shortRef(t.ref)}</code></td>
      <td className="ws-nowrap">{t.date ?? "—"}</td>
      <td className="ws-num">{usd(t.amount)}</td>
      <td>{t.merchantName ?? t.description ?? "—"}</td>
      <td>{t.status ?? "—"}</td>
      <td className={verdict === "Matched" ? "ws-strong" : "ws-muted"}>{verdict || "—"}</td>
    </tr>
  );
}

export function IdentityEvidence({ data }: { data: CaseView }) {
  return (
    <section id="identity" className="ws-section" aria-labelledby="identity-h">
      <div className="ws-section-head">
        <h2 id="identity-h">Identity evidence</h2>
        <p className="ws-muted ws-small">CRS sandbox test personas, linked to this case as a synthetic association. An identity mismatch is not evidence that a claim is false.</p>
      </div>
      {data.providerEvidence.length === 0 ? (
        <p className="ws-muted">
          {data.case.crsPersonaId ? `Test persona ${data.case.crsPersonaId} is linked, but no check has been run.` : "No identity check on this case."} Identity checks are run from the developer console.
        </p>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead><tr><th scope="col">Reference</th><th scope="col">Field</th><th scope="col">Value returned by provider</th></tr></thead>
            <tbody>
              {data.providerEvidence.map((p) => <ProviderRow key={p._id} p={p} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProviderRow({ p }: { p: Doc<"providerEvidence"> }) {
  const anchor = useAnchor(p.ref);
  return (
    <tr {...anchor}>
      <td><code>{p.ref}</code></td>
      <td>{humanize(p.field)}</td>
      <td>{p.value}</td>
    </tr>
  );
}

export function DraftPacket({ analysis }: { analysis: StoredAnalysis | null }) {
  if (!analysis) return null;
  const p = analysis.packet;
  return (
    <section id="packet" className="ws-section" aria-labelledby="packet-h">
      <div className="ws-section-head">
        <h2 id="packet-h">Draft packet <span className="ws-tag">{p.readyForHumanReview ? "ready for human review" : "incomplete"}</span></h2>
        <p className="ws-muted ws-small">{p.notice}</p>
      </div>
      <p>
        <span className="ws-eyebrow">Draft recommendation</span> <strong>{RECOMMENDATION_LABEL[p.recommendation.action]}</strong> — {p.recommendation.rationale}
      </p>

      <details className="ws-details">
        <summary>Findings behind this draft ({analysis.findings.length})</summary>
        <ul className="ws-findings">
          {analysis.findings.map((f) => (
            <li key={f.id}>
              <span className="ws-tag">{humanize(f.category)}</span> <span className="ws-tag">{f.status}</span> {f.text}{" "}
              {f.evidenceRefs.filter((r) => !r.startsWith("R:")).map((r) => <RefChip key={r} refId={r} />)}
              {f.contradictions.length > 0 && <div className="ws-small ws-warn-text">Contradictions: {f.contradictions.join("; ")}</div>}
            </li>
          ))}
        </ul>
        {analysis.rejectedFindings.length > 0 && (
          <p className="ws-small ws-error-text">{analysis.rejectedFindings.length} proposed finding(s) were rejected by validation and are not used.</p>
        )}
      </details>

      <h3 className="ws-h3">Potentially relevant considerations</h3>
      <p className="ws-small ws-muted">Curated official sources only. Not legal determinations; whether any of them applies is for a person to decide.</p>
      {analysis.considerations.length === 0 && <p className="ws-muted">None identified for the current facts.</p>}
      {analysis.considerations.map((c) => {
        const src = getSource(c.sourceRef);
        return (
          <details key={c.sourceRef} className="ws-details ws-consideration">
            <summary>
              <strong>{src?.citation ?? c.sourceRef}</strong> <span className="ws-muted">— {c.relevance}</span>
            </summary>
            {src && !src.verbatimVerified && <p className="ws-small ws-warn-text">Excerpt paraphrased; verify against the source before citing.</p>}
            {src && <p className="ws-small ws-muted">{src.excerpt} {src.url.startsWith("http") && <a href={src.url} target="_blank" rel="noreferrer">Source</a>}</p>}
            <ul className="ws-conditions">
              {c.conditions.map((k) => (
                <li key={k.text}>
                  <span className="ws-tag">{humanize(k.status)}</span> {k.text} {k.refs.filter((r) => !r.startsWith("R:")).map((r) => <RefChip key={r} refId={r} />)}
                </li>
              ))}
            </ul>
            {c.reviewSteps.length > 0 && <p className="ws-small">Review steps: {c.reviewSteps.join(" ")}</p>}
          </details>
        );
      })}
    </section>
  );
}

type TimelineKind = "statement" | "evidence" | "handoff" | "problem" | "system";
const TIMELINE: Record<TimelineKind, string> = { statement: "Customer", evidence: "Evidence", handoff: "Handoff", problem: "Problem", system: "System" };

function activityKind(kind: string): TimelineKind {
  if (/error|rejected|warning|discarded/.test(kind)) return "problem";
  if (/retrieved|account_bound/.test(kind)) return "evidence";
  if (/handed_to_reviewer/.test(kind)) return "handoff";
  return "system";
}

export function Timeline({ data }: { data: CaseView }) {
  const [all, setAll] = useState(false);
  const items = [
    ...data.statements.map((s) => ({ key: s._id as string, at: s.receivedAt, kind: "statement" as TimelineKind, text: s.text, ref: s.ref, reply: s.inResponseTo?.text, corrects: s.correctsRef })),
    // Recording and interpretation entries repeat the statements above.
    ...data.activity
      .filter((a) => a.kind !== "interpreted" && a.kind !== "statement_recorded")
      .map((a) => ({ key: a._id as string, at: a.at, kind: activityKind(a.kind), text: a.message, ref: undefined, reply: undefined, corrects: undefined })),
  ].sort((a, b) => a.at - b.at);
  const LIMIT = 25;
  const shown = all ? items : items.slice(-LIMIT);
  return (
    <section id="timeline" className="ws-section" aria-labelledby="timeline-h">
      <div className="ws-section-head">
        <h2 id="timeline-h">Timeline</h2>
        <p className="ws-muted ws-small">Statements and recorded events, oldest first.</p>
      </div>
      {items.length > LIMIT && !all && (
        <button type="button" className="ws-link" onClick={() => setAll(true)}>Show {items.length - LIMIT} earlier events</button>
      )}
      <ol className="ws-timeline">
        {shown.map((it) => (
          <li key={it.key} className={`ws-tl ws-tl-${it.kind}`}>
            <span className="ws-tl-mark" aria-hidden="true" />
            <div className="ws-tl-body">
              <div className="ws-tl-head">
                <span className="ws-tl-kind">{TIMELINE[it.kind]}</span>
                <time dateTime={new Date(it.at).toISOString()} title={exactTime(it.at)}>{clockTime(it.at)}</time>
                {it.ref && <RefChip refId={it.ref} />}
                {it.corrects && <span>corrects <RefChip refId={it.corrects} /></span>}
              </div>
              {it.reply && <div className="ws-small ws-muted">In reply to “{it.reply}”</div>}
              <div className={it.kind === "statement" ? "ws-clamp-2" : "ws-small"}>{it.kind === "statement" ? `“${it.text}”` : it.text}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
