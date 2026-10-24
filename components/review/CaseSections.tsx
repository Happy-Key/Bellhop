"use client";

/** Customer account, bank records and identity sections of the case workspace. Display only, apart from bank retrieval. */
import { useEffect, useRef, useState } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { StoredAnalysis } from "@/lib/domain/triage";
import { RECONCILIATION_LABEL, reconciliation } from "@/lib/review/workspace";
import { RefChip, refAnchor, useIsActive } from "./EvidenceRef";
import { RetrieveButton } from "./RetrieveButton";
import { clockTime, exactTime, FIELD_LABEL, humanize, POSITION_LABEL, shortKey, shortRef, shortTime, usd } from "./format";
import { useWorkspaceMode } from "./WorkspaceMode";
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

export function ClampedText({ text }: { text: string }) {
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
        <h2 id="statements-h">Customer account <span className="ws-count">{data.statements.length}</span></h2>
        <p className="ws-muted ws-small">The customer&apos;s original statements and the question each answered. Reported and unverified. Stored after sensitive values are removed; never edited. Corrections are new statements that link back.</p>
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
  const excluded = new Map(match?.excluded.map((x) => [x.txnRef, x.reason]) ?? []);
  const historyCount = data.history.transactions.length;
  const demo = useWorkspaceMode() === "demo";
  return (
    <section id="records" className="ws-section" aria-labelledby="records-h">
      <div className="ws-section-head">
        <h2 id="records-h">Bank records <span className="ws-count">{data.transactions.length}</span></h2>
        <p className="ws-muted ws-small">{demo ? "Fixture records in the Nessie shape, part of the scripted demo. Not retrieved from Nessie." : "Capital One Nessie sandbox (live API, synthetic account). Retrieval is read-only."}</p>
      </div>
      <div className="ws-fetch">
        {bf.status === "never" && <span>Not retrieved yet.</span>}
        {bf.status === "ok" && <span>{demo ? "Loaded" : "Retrieved"} {bf.count} record{bf.count === 1 ? "" : "s"} · {exactTime(bf.at)}</span>}
        {bf.status === "error" && <span className="ws-error-text" role="status">Retrieval failed: {bf.error}. No sample data was substituted.</span>}
        <RetrieveButton caseId={data.case._id} again={bf.status !== "never"} />
      </div>
      {!demo && !data.case.nessieAccountBound && <p className="ws-small ws-warn-text">No demo account is bound yet; the backend binds the configured account on first retrieval.</p>}
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
                <th scope="col">Reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <TxnRow
                  key={t._id}
                  t={t}
                  focused={t.ref === focusedRef}
                  verdict={(() => {
                    const r = reconciliation(analysis, t.ref);
                    if (r.state === "unrelated") return "";
                    return r.state === "excluded" ? `Excluded: ${excluded.get(t.ref)}` : RECONCILIATION_LABEL[r.state];
                  })()}
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
      <td className={verdict && !verdict.startsWith("Excluded") ? "ws-strong" : "ws-muted"}>{verdict || "—"}</td>
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
