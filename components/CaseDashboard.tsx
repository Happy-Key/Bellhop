"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { CaseAnalysis } from "@/lib/domain/workflow";
import { getSource } from "@/lib/domain/regulatory";
import { DEMO_STATEMENTS } from "@/lib/fixtures/demo";
import { CRS_PERSONAS, getCrsPersona } from "@/lib/fixtures/crsPersonas";
import { IntegrationStatus } from "./IntegrationStatus";

type StoredAnalysis = Omit<CaseAnalysis, "rejectedFindings"> & { rejectedFindings: { finding: string; reasons: string[] }[] };

const usd = (n: number) => `$${n.toFixed(2)}`;

export function CaseDashboard({ caseId }: { caseId: string }) {
  const id = caseId as Id<"cases">;
  const data = useQuery(api.cases.view, { caseId: id });
  if (data === undefined) return <p className="muted">Loading…</p>;
  if (data === null) return <p className="error">Case not found.</p>;
  const analysis = data.case.analysis as StoredAnalysis | null;

  return (
    <main>
      <p><Link href="/">← all cases</Link></p>
      <h1>
        <span className="label synthetic">synthetic</span>
        {data.case.title}
      </h1>
      <p className="muted">
        Customer: {data.case.customerLabel}. Stage: <strong>{analysis?.stage ?? "intake"}</strong>. Workflow: intake → retrieve evidence → match →
        clarify → assess considerations → prepare packet → human review.
      </p>
      <div className="grid">
        <Statements caseId={id} statements={data.statements} />
        <Evidence caseId={id} c={data.case} transactions={data.transactions} providerEvidence={data.providerEvidence} analysis={analysis} />
      </div>
      {analysis && <FindingsAndQuestions analysis={analysis} />}
      {analysis && <Packet analysis={analysis} />}
      <Activity activity={data.activity} />
      <IntegrationStatus />
    </main>
  );
}

function Statements({ caseId, statements }: { caseId: Id<"cases">; statements: Doc<"statements">[] }) {
  const submit = useMutation(api.cases.submitStatement);
  const [text, setText] = useState("");
  const [correctsRef, setCorrectsRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const retryLive = useMutation(api.statements.retryLive);
  const scripted = useMutation(api.statements.interpretScriptedExplicitly);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await submit({ caseId, text, clientEventId: crypto.randomUUID(), ...(correctsRef ? { correctsRef } : {}) });
      setText("");
      setCorrectsRef("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>1. Conversation — customer statements <span className="muted">(customer-reported, unverified)</span></h2>
      {statements.length === 0 && <p className="muted">No statements yet.</p>}
      {statements.map((s) => (
        <div key={s._id} style={{ marginBottom: 8 }}>
          <div>
            <span className="ref">{s.ref}</span> <span className="label">{s.channel}</span>
            {s.correctsRef && <span className="label">corrects {s.correctsRef}</span>}
            <span className="muted">{new Date(s.receivedAt).toLocaleTimeString()}</span>
          </div>
          <div>“{s.text}”</div>
          <Interpretation s={s} onRetry={() => retryLive({ statementId: s._id })} onScripted={() => scripted({ statementId: s._id })} />
          {s.followUpQuestion && <div className="muted">Model-suggested follow-up: {s.followUpQuestion}</div>}
        </div>
      ))}
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Customer statement (text channel)…" />
      <div>
        Corrects:{" "}
        <select value={correctsRef} onChange={(e) => setCorrectsRef(e.target.value)}>
          <option value="">(not a correction)</option>
          {statements.map((s) => (
            <option key={s.ref} value={s.ref}>{s.ref}</option>
          ))}
        </select>{" "}
        <button disabled={busy || !text.trim()} onClick={onSubmit}>Record statement</button>
      </div>
      {error && <p className="error">{error}</p>}
      <details>
        <summary className="muted">Demo statements (synthetic script)</summary>
        {DEMO_STATEMENTS.map((d) => (
          <div key={d}><button onClick={() => setText(d)}>use</button> {d}</div>
        ))}
      </details>
      <p className="muted">Voice input: Cartesia backend endpoints exist; the browser call client is not implemented yet.</p>
    </section>
  );
}

function Interpretation({ s, onRetry, onScripted }: { s: Doc<"statements">; onRetry: () => void; onScripted: () => void }) {
  if (s.interpretationStatus === "pending") return <div className="muted">Interpretation pending (live model)…</div>;
  if (s.interpretationStatus === "failed")
    return (
      <div className="error">
        Live interpretation failed: {s.interpretationError}. Not interpreted.{" "}
        <button onClick={onRetry}>Retry live</button>
        <button onClick={onScripted}>Interpret with SCRIPTED extractor instead</button>
      </div>
    );
  const i = s.interpretation;
  if (!i) return null;
  return (
    <div className="muted">
      <span className={`label ${i.mode === "live" ? "live" : "scripted"}`}>{i.mode === "live" ? `model: ${i.provider}` : "scripted"}</span>
      amounts [{i.amounts.map(usd).join(", ")}] · dates [{i.dates.join(", ")}] · merchant terms [{i.merchantTerms.join(", ")}] · authorization {i.authorization} ·
      credentials {i.credentialSharing}
      {i.scamIndicators.length > 0 && ` · scam indicators [${i.scamIndicators.join(", ")}]`}
    </div>
  );
}

function Evidence({ caseId, c, transactions, providerEvidence, analysis }: {
  caseId: Id<"cases">;
  c: Doc<"cases"> & { nessieAccountBound: boolean };
  transactions: Doc<"transactions">[];
  providerEvidence: Doc<"providerEvidence">[];
  analysis: StoredAnalysis | null;
}) {
  const retrieve = useAction(api.nessie.retrieveBankEvidence);
  const [busy, setBusy] = useState(false);
  const candidateRefs = new Set(analysis?.match.candidates.map((x) => x.txnRef) ?? []);
  const excluded = new Map(analysis?.match.excluded.map((x) => [x.txnRef, x.reason]) ?? []);
  const matched = analysis?.match.matchedRef;
  const bf = c.bankFetch;

  return (
    <section>
      <h2>2. Evidence</h2>
      <h3 style={{ fontSize: 14 }}>Bank records — Capital One Nessie <span className="label live">live API</span><span className="label synthetic">synthetic account</span></h3>
      <button disabled={busy} onClick={async () => { setBusy(true); try { await retrieve({ caseId }); } finally { setBusy(false); } }}>
        {busy ? "Retrieving…" : "Retrieve bank records (live Nessie call)"}
      </button>
      <div>
        {bf.status === "never" && <span className="muted">Not retrieved yet.</span>}
        {bf.status === "ok" && <span className="live">Retrieved {bf.count} record(s) at {new Date(bf.at).toLocaleTimeString()}.</span>}
        {bf.status === "error" && <span className="error">Retrieval failed: {bf.error}. No fixture data substituted.</span>}
        {!c.nessieAccountBound && <div className="error">No Nessie account bound to this case.</div>}
      </div>
      {transactions.length > 0 && (
        <table>
          <thead><tr><th>Ref</th><th>Date</th><th>Amount</th><th>Merchant</th><th>Status</th><th>Match</th></tr></thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t._id} style={t.ref === matched ? { fontWeight: 600 } : undefined}>
                <td className="ref">{t.ref}</td>
                <td>{t.date ?? "?"}</td>
                <td>{usd(t.amount)}</td>
                <td>{t.merchantName ?? t.description ?? "?"}</td>
                <td>{t.status ?? "?"}</td>
                <td>{t.ref === matched ? "MATCH (rule-based)" : candidateRefs.has(t.ref) ? "candidate" : excluded.has(t.ref) ? `excluded: ${excluded.get(t.ref)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {analysis && analysis.match.candidates.length > 0 && (
        <div className="muted">
          Matcher outcome: <strong>{analysis.match.outcome}</strong>.{" "}
          {analysis.match.candidates.map((x) => `${x.txnRef}: ${x.reasons.map((r) => `${r.detail} [${r.statementRef}]`).join("; ")}${x.contradictions.length ? ` — ${x.contradictions.join("; ")}` : ""}`).join(" | ")}
        </div>
      )}
      <CrsEvidence caseId={caseId} personaId={c.crsPersonaId ?? null} evidence={providerEvidence} />
    </section>
  );
}

function CrsEvidence({ caseId, personaId, evidence }: { caseId: Id<"cases">; personaId: string | null; evidence: Doc<"providerEvidence">[] }) {
  const link = useMutation(api.crsData.linkPersona);
  const run = useAction(api.crs.retrieveIdentityEvidence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const persona = personaId ? getCrsPersona(personaId) : undefined;
  return (
    <>
      <h3 style={{ fontSize: 14 }}>
        External evidence — CRS identity check <span className="label live">live sandbox API</span><span className="label synthetic">synthetic association</span>
      </h3>
      <p className="muted">CRS test personas are a separate dataset from Nessie customers. Linking one to this case is a synthetic demonstration association.</p>
      <div>
        Test persona:{" "}
        <select value={personaId ?? ""} onChange={(e) => e.target.value && link({ caseId, personaId: e.target.value })}>
          <option value="">(none linked)</option>
          {CRS_PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.id} {p.name}</option>)}
        </select>{" "}
        <button
          disabled={busy || !personaId}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await run({ caseId });
              if (!r.ok) setError(r.error ?? "failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Checking…" : "Run identity check (live CRS sandbox)"}
        </button>
      </div>
      {persona && <div className="muted">CRS-documented expected result: {persona.expected}</div>}
      {error && <div className="error">CRS check failed: {error}. No fixture data substituted.</div>}
      {evidence.length > 0 && (
        <table>
          <thead><tr><th>Ref</th><th>Field</th><th>Value (returned by provider)</th></tr></thead>
          <tbody>
            {evidence.map((e) => <tr key={e._id}><td className="ref">{e.ref}</td><td>{e.field}</td><td>{e.value}</td></tr>)}
          </tbody>
        </table>
      )}
      <p className="muted">An identity mismatch is not evidence that the claim is false, and CRS does not verify who owns the receiving account.</p>
    </>
  );
}

function FindingsAndQuestions({ analysis }: { analysis: StoredAnalysis }) {
  return (
    <section>
      <h2>3. Findings and unresolved questions</h2>
      <table>
        <thead><tr><th>ID</th><th>Finding</th><th>Category</th><th>Evidence</th><th>Status</th><th>Contradictions</th></tr></thead>
        <tbody>
          {analysis.findings.map((f) => (
            <tr key={f.id}>
              <td className="ref">{f.id}</td>
              <td>{f.text}</td>
              <td><span className={`label ${f.category === "model_inference" ? "live" : f.category === "rule_based_inference" ? "scripted" : ""}`}>{f.category}</span></td>
              <td className="ref">{f.evidenceRefs.join(", ")}</td>
              <td>{f.status}</td>
              <td>{f.contradictions.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {analysis.rejectedFindings.length > 0 && (
        <details>
          <summary className="error">{analysis.rejectedFindings.length} proposed finding(s) rejected by validation</summary>
          {analysis.rejectedFindings.map((r, i) => <div key={i} className="muted"><code>{r.finding}</code> — {r.reasons.join("; ")}</div>)}
        </details>
      )}
      <h3 style={{ fontSize: 14 }}>Unresolved questions</h3>
      {analysis.questions.length === 0 ? <p className="muted">None.</p> : (
        <ul>
          {analysis.questions.map((q) => (
            <li key={q.id}><span className="ref">{q.id}</span> {q.blocking ? <span className="label error">blocking</span> : <span className="label">non-blocking</span>} {q.text} <span className="muted ref">{q.relatedRefs.join(", ")}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Packet({ analysis }: { analysis: StoredAnalysis }) {
  const p = analysis.packet;
  return (
    <section>
      <h2>4. Draft claim packet <span className="label">{p.readyForHumanReview ? "ready for human review" : "incomplete"}</span></h2>
      <p className="muted">{p.notice}</p>
      <ul>{p.summary.map((s) => <li key={s}>{s}</li>)}</ul>
      <p>
        Recommended next action: <strong>{p.recommendation.action.replace(/_/g, " ")}</strong> — {p.recommendation.rationale}
        {p.recommendation.blockingQuestionIds.length > 0 && <span className="muted"> (blocked by {p.recommendation.blockingQuestionIds.join(", ")})</span>}
      </p>
      <h3 style={{ fontSize: 14 }}>Potentially relevant regulatory considerations (U.S. consumer deposit accounts; curated sources only)</h3>
      {analysis.considerations.length === 0 && <p className="muted">None identified for the current facts.</p>}
      {analysis.considerations.map((c) => {
        const src = getSource(c.sourceRef);
        return (
          <div key={c.sourceRef} style={{ marginBottom: 8 }}>
            <div>
              <span className="ref">{c.sourceRef}</span> <span className="label">{src?.kind}</span> <strong>{src?.citation}</strong>{" "}
              {src && (src.url.startsWith("http") ? <a href={src.url} target="_blank" rel="noreferrer">source</a> : <span className="muted">{src.url}</span>)}
              {src && !src.verbatimVerified && <span className="label error">excerpt paraphrased — verify before citing</span>}
            </div>
            <div className="muted">{src?.excerpt}</div>
            <div>{c.relevance}</div>
            <ul>{c.conditions.map((k) => <li key={k.text}>[{k.status.replace(/_/g, " ")}] {k.text} <span className="ref muted">{k.refs.join(", ")}</span></li>)}</ul>
            <div className="muted">Review steps: {c.reviewSteps.join(" ")}</div>
          </div>
        );
      })}
      <p className="muted">No legal deadlines are calculated. Regulation E is not presumed to apply; scam payments are not presumed reimbursable.</p>
    </section>
  );
}

function Activity({ activity }: { activity: Doc<"activity">[] }) {
  return (
    <section>
      <h2>5. Activity log</h2>
      <table>
        <tbody>
          {activity.map((a) => (
            <tr key={a._id}>
              <td className="muted">{new Date(a.at).toLocaleTimeString()}</td>
              <td className="ref">{a.actor}</td>
              <td className={a.kind.includes("error") ? "error" : undefined}>{a.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
