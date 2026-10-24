"use client";

/**
 * Claim suite (/review/suite): every SYNTHETIC demo persona with its expected outcome, a button to
 * play its script live as a text chat on a new case (convex/suite.ts), and how the result compares.
 * The verdict covers what code decides (matched record, AUTO-1 checks, route); the model's proposed
 * disposition is shown beside it as advisory.
 */
import { Fragment, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.suite.results>>>[number];

const ROUTE = { auto_approve: "Approved automatically", person: "A person decides" } as const;
const VERDICT_LABEL = { pass: "As expected", differs: "Differs", pending: "Settling…" } as const;
const MODEL_STATE = { off: "Model off", none: "No assessment yet", pending: "Reassessing…", failed: "Model call failed" } as const;
const checkLabel = (id: string) => id.replace(/_/g, " ");

export function ClaimSuite() {
  const rows = useQuery(api.suite.results);
  const start = useMutation(api.suite.start);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run(personaIds: string[], label: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await start({ personaIds });
      setMessage(`${label}: ${r.queued} run(s) queued${r.skipped ? `, ${r.skipped} already running` : ""}. Runs start 12 s apart.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (rows === undefined) return <main className="ws-main"><p className="ws-muted">Loading the suite…</p></main>;

  const counts = { pass: 0, differs: 0, pending: 0, notRun: 0 };
  for (const r of rows) {
    if (!r.run) counts.notRun++;
    else if (r.run.status === "error") counts.differs++;
    else counts[r.verdict?.verdict ?? "pending"]++;
  }
  const ids = (group?: "core" | "suite") => rows.filter((r) => !group || r.persona.group === group).map((r) => r.persona.id);

  return (
    <main className="ws-main cs">
      <header className="cs-head">
        <div>
          <h1>Claim suite</h1>
          <p className="ws-muted">
            {rows.length} SYNTHETIC personas, each with a script and the outcome it should reach. A run plays the script as a customer text chat on
            a new case, through the same path as <Link href="/call">the customer line</Link>, with live Nessie, CRS and (when configured) Bitdeer.
          </p>
        </div>
        <div className="cs-actions">
          <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => run(ids(), "Whole suite")}>Run all {rows.length}</button>
          <button type="button" className="ws-btn" disabled={busy} onClick={() => run(ids("core"), "Core personas")}>Run the core {ids("core").length}</button>
          <button type="button" className="ws-btn" disabled={busy} onClick={() => run(ids("suite"), "Suite personas")}>Run the other {ids("suite").length}</button>
        </div>
      </header>
      <p className="ws-small ws-muted">
        Each run opens a new case and makes live provider calls (Nessie, CRS, and one Bitdeer call per statement plus a reassessment per case
        change). To start from an empty database: <code>npm run reset:convex -- --confirm</code>.
      </p>
      {message && <p className="cs-message" role="status">{message}</p>}

      <p className="cs-summary" aria-label="Summary">
        <span className="cs-v cs-v-pass">{counts.pass} as expected</span>
        <span className="cs-v cs-v-differs">{counts.differs} differ</span>
        <span className="cs-v cs-v-pending">{counts.pending} settling</span>
        <span className="cs-v">{counts.notRun} not run</span>
      </p>

      <div className="ws-table-wrap">
        <table className="ws-table cs-table">
          <thead>
            <tr>
              <th scope="col">Persona</th>
              <th scope="col">Expected</th>
              <th scope="col">Result</th>
              <th scope="col">Model proposal</th>
              <th scope="col">Verdict</th>
              <th scope="col"><span className="cs-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.persona.id}>
                <SuiteRow row={r} busy={busy} expanded={open === r.persona.id} onToggle={() => setOpen(open === r.persona.id ? null : r.persona.id)} onRun={() => run([r.persona.id], r.persona.name)} />
                {open === r.persona.id && (
                  <tr className="cs-detail">
                    <td colSpan={6}>
                      <SuiteDetail row={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function SuiteRow({ row: r, busy, expanded, onToggle, onRun }: { row: Row; busy: boolean; expanded: boolean; onToggle: () => void; onRun: () => void }) {
  const o = r.observation;
  const running = r.run?.status === "queued" || r.run?.status === "running";
  const verdict = r.run?.status === "error" ? "error" : r.verdict?.verdict ?? null;
  return (
    <tr>
      <th scope="row">
        <button type="button" className="cs-name" aria-expanded={expanded} onClick={onToggle}>
          {r.persona.name}
        </button>
        {r.persona.group === "core" && <span className="ws-tag">core</span>}
        <div className="ws-small ws-muted">{r.persona.scenario}</div>
      </th>
      <td>
        <strong>{ROUTE[r.persona.expected.route]}</strong>
        <Checks ids={r.persona.expected.failingChecks} empty="every check passes" />
      </td>
      <td>
        {!r.run ? (
          <span className="ws-muted">Not run</span>
        ) : running ? (
          <span className="ws-muted">{r.run.status === "queued" ? "Queued…" : `Running (${r.run.transcript.length} message${r.run.transcript.length === 1 ? "" : "s"})…`}</span>
        ) : r.run.caseDeleted ? (
          <span className="ws-muted">Case deleted</span>
        ) : o ? (
          <>
            <strong>{o.autoApproved ? ROUTE.auto_approve : ROUTE.person}</strong>
            {o.failingChecks ? <Checks ids={o.failingChecks} empty="every check passes" /> : <div className="ws-small ws-muted">AUTO-1 not evaluated</div>}
            <div className="ws-small ws-muted">Matched: {o.matchedKey ?? "no single record"}</div>
          </>
        ) : (
          <span className="ws-muted">—</span>
        )}
      </td>
      <td>
        {o ? (
          o.model.state === "done" && o.model.decision ? (
            <>
              <strong>{o.model.decision.replace(/_/g, " ")}</strong>
              <div className="ws-small ws-muted">{r.verdict?.modelReasonable ? "a reasonable proposal" : `expected ${r.persona.expected.reasonableDecisions.map((d) => d.replace(/_/g, " ")).join(" or ")}`}</div>
            </>
          ) : (
            <span className="ws-muted" title={o.model.problem ?? undefined}>{o.model.state === "done" ? "No proposal" : MODEL_STATE[o.model.state]}</span>
          )
        ) : (
          <span className="ws-muted">—</span>
        )}
      </td>
      <td>
        {verdict ? <span className={`cs-v cs-v-${verdict}`}>{verdict === "error" ? "Run failed" : VERDICT_LABEL[verdict]}</span> : <span className="ws-muted">—</span>}
      </td>
      <td className="cs-row-actions">
        <button type="button" className="ws-btn" disabled={busy || running} onClick={onRun}>{r.run ? "Run again" : "Run"}</button>
        {r.run?.caseId && !r.run.caseDeleted && <Link className="ws-btn" href={`/review/${r.run.caseId}`}>Open case</Link>}
      </td>
    </tr>
  );
}

function Checks({ ids, empty }: { ids: string[]; empty: string }) {
  if (ids.length === 0) return <div className="ws-small ws-muted">{empty}</div>;
  return (
    <ul className="cs-checks">
      {ids.map((id) => (
        <li key={id}>{checkLabel(id)}</li>
      ))}
    </ul>
  );
}

function SuiteDetail({ row: r }: { row: Row }) {
  return (
    <div className="cs-detail-body">
      <section>
        <h3>What a person should weigh</h3>
        <p>{r.persona.expected.reviewFocus}</p>
        <p className="ws-small ws-muted">
          CRS test identity {r.persona.crsPersonaId}. Disputed purchase: {r.persona.disputedKey}
          {r.persona.expected.match === "none" ? " (with others; the rules can't settle on one record)" : ""}.
        </p>
        {r.verdict && r.verdict.differences.length > 0 && (
          <>
            <h3>Differences</h3>
            <ul>{r.verdict.differences.map((d) => <li key={d}>{d}</li>)}</ul>
          </>
        )}
        {r.observation?.pending && <p className="ws-muted">{r.observation.pending}</p>}
        {r.observation?.model.problem && <p className="ws-small">Model: {r.observation.model.problem}</p>}
        {r.run?.error && <p className="ws-small">Run error: {r.run.error}</p>}
      </section>
      <section>
        <h3>Transcript</h3>
        {r.run && r.run.transcript.length > 0 ? (
          <ol className="cs-transcript">
            {r.run.transcript.map((m, i) => (
              <li key={i} className={m.role === "customer" ? "cs-customer" : "cs-assistant"}>
                <span className="ws-small ws-muted">{m.role === "customer" ? "Customer" : "Assistant"}</span> {m.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="ws-muted">No run yet.</p>
        )}
      </section>
    </div>
  );
}
