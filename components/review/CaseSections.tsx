"use client";

/**
 * The evidence itself, for the inspector's Evidence tab: customer statements, bank records and
 * identity evidence, each with the live actions a reviewer may need (retrieve records again,
 * attach a SYNTHETIC payment-origin record, run the CRS checks). Display only otherwise.
 */
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { StoredAnalysis } from "@/lib/domain/triage";
import { PAYMENT_ORIGIN_PRESETS } from "@/lib/fixtures/paymentOrigins";
import { RECONCILIATION_LABEL, reconciliation } from "@/lib/review/workspace";
import { RefChip, refAnchor, useIsActive } from "./EvidenceRef";
import { RetrieveButton } from "./RetrieveButton";
import { clockTime, exactTime, FIELD_LABEL, humanize, POSITION_LABEL, shortKey, shortRef, shortTime, usd } from "./format";
import { errorText } from "./ui";
import type { CaseView, ViewStatement, ViewTransaction } from "./types";
import { useWorkspaceMode, useWorkspaceOptional } from "./WorkspaceContext";

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
      <p ref={ref} className={open ? undefined : "ws-clamp-6"}>
        “{text}”
      </p>
      {(overflows || open) && (
        <button type="button" className="ws-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
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
        <h2 id="statements-h">
          Customer statements <span className="ws-count">{data.statements.length}</span>
        </h2>
      </div>
      {data.statements.length === 0 && <p className="ws-muted ws-small">None yet.</p>}
      <ol className="ws-statements">
        {data.statements.map((s) => (
          <StatementCard key={s._id} s={s} superseded={supersededBy.get(s.ref)} />
        ))}
      </ol>
    </section>
  );
}

function StatementCard({ s, superseded }: { s: ViewStatement; superseded?: { by: string; fields: string[] } }) {
  const anchor = useAnchor(s.ref);
  const ws = useWorkspaceOptional();
  const live = useWorkspaceMode() === "live";
  const i = s.interpretation;
  return (
    <li className="ws-stmt" {...anchor}>
      <div className="ws-stmt-head">
        <RefChip refId={s.ref} />
        <span className="ws-tag">{s.channel}</span>
        <time dateTime={new Date(s.receivedAt).toISOString()} title={exactTime(s.receivedAt)}>
          {clockTime(s.receivedAt)}
        </time>
        {s.correctsRef && (
          <span>
            corrects <RefChip refId={s.correctsRef} />
          </span>
        )}
        {superseded && (
          <span className="ws-muted">
            {superseded.fields.map((f) => FIELD_LABEL[f] ?? humanize(f)).join(", ")} superseded by <RefChip refId={superseded.by} />
          </span>
        )}
        {ws && (
          <button type="button" className="ws-link" onClick={() => ws.select({ kind: "evidence", ref: s.ref })}>
            Inspect
          </button>
        )}
      </div>
      {s.inResponseTo && (
        <div className="ws-reply">
          <span className="ws-eyebrow">In reply to</span> “{s.inResponseTo.text}”{" "}
          <code className="ws-key" title={`Stable question key: ${s.inResponseTo.key}`}>
            {shortKey(s.inResponseTo.key)}
          </code>
          {s.answer && <span className={`ws-answer ws-answer-${s.answer.state}`}>{ANSWER_LABEL[s.answer.state]}</span>}
        </div>
      )}
      <div className="ws-stmt-text">
        <ClampedText text={s.text} />
      </div>
      {s.redactions && s.redactions.length > 0 && <p className="ws-small ws-muted">Removed: {s.redactions.map(humanize).join(", ")}</p>}
      {s.interpretationStatus === "pending" && <p className="ws-small ws-muted">Interpretation pending…</p>}
      {s.interpretationStatus === "failed" && (
        <p className="ws-small ws-error-text">
          Not interpreted: {s.interpretationError}.{live && <RetryControls statementId={s._id} />}
        </p>
      )}
      {i && (
        <dl className="ws-extract">
          <dt>Read by</dt>
          <dd>
            <span className={`ws-tag ${i.mode === "live" ? "ws-tag-live" : ""}`}>{i.mode === "live" ? `model · ${i.provider}` : "scripted rules"}</span>
          </dd>
          {i.amounts.length > 0 && (
            <>
              <dt>Amounts</dt>
              <dd>{i.amounts.map(usd).join(", ")}</dd>
            </>
          )}
          {i.merchantTerms.length > 0 && (
            <>
              <dt>Payee terms</dt>
              <dd>{i.merchantTerms.join(", ")}</dd>
            </>
          )}
          {i.authorization !== "unspecified" && (
            <>
              <dt>Position</dt>
              <dd>{POSITION_LABEL[i.authorization]}</dd>
            </>
          )}
        </dl>
      )}
    </li>
  );
}

function RetryControls({ statementId }: { statementId: Id<"statements"> }) {
  const retry = useMutation(api.statements.retryLive);
  const scripted = useMutation(api.statements.interpretScriptedExplicitly);
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<unknown>) => f().catch((e) => setError(errorText(e)));
  return (
    <span className="ws-action">
      <button type="button" className="btn btn-sm" onClick={() => run(() => retry({ statementId }))}>
        Retry live
      </button>
      <button type="button" className="btn btn-sm" onClick={() => run(() => scripted({ statementId }))}>
        Use the scripted reader
      </button>
      {error && <span className="ws-error-text">{error}</span>}
    </span>
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
        <h2 id="records-h">
          Bank records <span className="ws-count">{data.transactions.length}</span>
        </h2>
      </div>
      <div className="ws-fetch">
        {bf.status === "never" && <span>Not retrieved yet.</span>}
        {bf.status === "ok" && (
          <span>
            {demo ? "Loaded" : "Retrieved"} {bf.count} record{bf.count === 1 ? "" : "s"} · {exactTime(bf.at)}
          </span>
        )}
        {bf.status === "error" && (
          <span className="ws-error-text" role="status">
            Retrieval failed: {bf.error}
          </span>
        )}
        <RetrieveButton caseId={data.case._id} again={bf.status !== "never"} />
      </div>
      {data.transactions.length > 0 && (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Date</th>
                <th scope="col" className="ws-num">
                  Amount
                </th>
                <th scope="col">Payee</th>
                <th scope="col">Reconciliation</th>
                <th scope="col">How it was made</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.map((t) => (
                <TxnRow
                  key={t._id}
                  t={t}
                  caseId={data.case._id}
                  origin={data.paymentOrigins.find((o) => o.txnRef === t.ref) ?? null}
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
          <summary>
            {historyCount} earlier record version{historyCount === 1 ? "" : "s"} (superseded, kept for history)
          </summary>
          <table className="ws-table ws-table-muted">
            <tbody>
              {data.history.transactions.map((t) => (
                <tr key={t._id}>
                  <td>
                    <code title={t.ref}>{shortRef(t.ref)}</code>
                  </td>
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

function TxnRow({ t, caseId, origin, focused, verdict }: { t: ViewTransaction; caseId: Id<"cases">; origin: CaseView["paymentOrigins"][number] | null; focused: boolean; verdict: string }) {
  const anchor = useAnchor(t.ref);
  const live = useWorkspaceMode() === "live";
  const setOrigin = useMutation(api.paymentOrigins.setSynthetic);
  const [error, setError] = useState<string | null>(null);
  return (
    <tr {...anchor} data-focused={focused || undefined}>
      <td>
        <RefChip refId={t.ref} />
      </td>
      <td className="ws-nowrap">{t.date ?? "—"}</td>
      <td className="ws-num">{usd(t.amount)}</td>
      <td>
        {t.merchantName ?? t.description ?? "—"}
        {t.kind !== "purchase" && <span className="ws-muted"> · {t.kind}</span>}
      </td>
      <td className={verdict && !verdict.startsWith("Excluded") ? "ws-strong" : "ws-muted"}>{verdict || "—"}</td>
      <td>
        {t.kind === "deposit" ? (
          <span className="ws-muted">—</span>
        ) : live ? (
          <>
            <select
              aria-label={`Payment origin for ${shortRef(t.ref)} (synthetic)`}
              value={origin?.preset ?? ""}
              onChange={(e) => {
                if (!e.target.value) return;
                setOrigin({ caseId, txnRef: t.ref, preset: e.target.value }).catch((err) => setError(errorText(err)));
              }}
            >
              <option value="">(no record)</option>
              {Object.entries(PAYMENT_ORIGIN_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>
                  {p.label}
                </option>
              ))}
            </select>
            {error && <span className="ws-error-text ws-small"> {error}</span>}
          </>
        ) : origin ? (
          <span className="ws-small">{PAYMENT_ORIGIN_PRESETS[origin.preset as keyof typeof PAYMENT_ORIGIN_PRESETS]?.label ?? origin.preset}</span>
        ) : (
          <span className="ws-muted">—</span>
        )}
      </td>
    </tr>
  );
}

export function IdentityEvidence({ data }: { data: CaseView }) {
  const live = useWorkspaceMode() === "live";
  return (
    <section id="identity" className="ws-section" aria-labelledby="identity-h">
      <div className="ws-section-head">
        <h2 id="identity-h">Identity evidence</h2>
      </div>
      {data.providerEvidence.length === 0 ? (
        <p className="ws-muted ws-small">{data.case.crsPersonaId ? "No check run yet." : "No identity linked."}</p>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Field</th>
                <th scope="col">Value returned by the provider</th>
              </tr>
            </thead>
            <tbody>
              {data.providerEvidence.map((p) => (
                <ProviderRow key={p._id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {live && data.case.crsPersonaId && <CrsRun caseId={data.case._id} again={data.providerEvidence.length > 0} />}
    </section>
  );
}

function CrsRun({ caseId, again }: { caseId: Id<"cases">; again: boolean }) {
  const runIdentity = useAction(api.crs.retrieveIdentityEvidence);
  const runFraud = useAction(api.crs.retrieveFraudRisk);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <p className="ws-action">
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const identity = await runIdentity({ caseId });
            const fraud = await runFraud({ caseId });
            const errors = [identity.ok ? null : `identity: ${identity.error ?? "failed"}`, fraud.ok ? null : `Fraud Finder: ${fraud.error ?? "failed"}`].filter(Boolean);
            if (errors.length) setError(errors.join("; "));
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : again ? "Run CRS checks again" : "Run CRS checks"}
      </button>
      {error && (
        <span className="ws-small ws-error-text" role="status">
          {error}
        </span>
      )}
    </p>
  );
}

function ProviderRow({ p }: { p: CaseView["providerEvidence"][number] }) {
  const anchor = useAnchor(p.ref);
  return (
    <tr {...anchor}>
      <td>
        <RefChip refId={p.ref} />
      </td>
      <td>{humanize(p.field)}</td>
      <td>{p.value}</td>
    </tr>
  );
}
