"use client";

/**
 * Pitch demo (/review/demo): five short acts that show what the product does, from a customer's
 * account of a payment to a proposed outcome a person authorizes. The customer's lines and the
 * model's outputs are a scripted replay (lib/fixtures/pitchDemo.ts); the guardrails that check them
 * are the app's real code (lib/review/pitchDemo.ts). Nothing is fetched, saved or sent.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PROPOSED_DECISIONS, type ProposedDecision } from "@/lib/domain/caseDecision";
import { PITCH_MATCHED_REF, PITCH_REASONING, PITCH_TURNS, type PitchReasoning } from "@/lib/fixtures/pitchDemo";
import { buildPitchCase, resolveRef, type PitchCase } from "@/lib/review/pitchDemo";
import { usd } from "./format";

const ACTS = [
  { kicker: "The problem", title: "Every fraud claim is rebuilt by hand." },
  { kicker: "The experience", title: "The customer just explains." },
  { kicker: "The intelligence", title: "One answer changes the investigation." },
  { kicker: "The result", title: "The reviewer gets a finished case." },
  { kicker: "The control", title: "A person makes the call." },
] as const;

const DECISION_LABEL: Record<ProposedDecision, string> = {
  approve: "Approve reimbursement",
  deny: "Deny",
  request_information: "Request information",
  escalate: "Escalate to scam specialist",
};
const READING_LABEL = { likely_applies: "Likely applies", likely_does_not_apply: "Likely doesn't apply", unclear: "Unclear" } as const;
const DOC_LABEL = { investigation_summary: "Investigation summary", customer_letter: "Customer letter", information_request: "Information request" } as const;

export function PitchDemo() {
  const c = useMemo(() => buildPitchCase(), []);
  const [act, setAct] = useState(0);
  const last = ACTS.length - 1;
  const go = (n: number) => setAct(Math.max(0, Math.min(last, n)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") setAct((a) => Math.min(last, a + 1));
      if (e.key === "ArrowLeft") setAct((a) => Math.max(0, a - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  return (
    <main className="ws-main pd">
      <nav className="pd-progress" aria-label="Demo">
        <ol>
          {ACTS.map((a, i) => (
            <li key={a.kicker}>
              <button type="button" aria-current={i === act ? "step" : undefined} data-done={i < act || undefined} onClick={() => go(i)}>
                <span className="pd-num">{i + 1}</span> <span className="pd-kicker-label">{a.kicker.replace("The ", "").replace(/^./, (x) => x.toUpperCase())}</span>
              </button>
            </li>
          ))}
        </ol>
        <span className="ws-demo-tag">Scripted replay · synthetic data</span>
      </nav>

      <header className="pd-head" aria-live="polite">
        <p className="pd-kicker">{ACTS[act]!.kicker}</p>
        <h1>{ACTS[act]!.title}</h1>
      </header>

      <div className="pd-stage">
        {act === 0 && <Problem />}
        {(act === 1 || act === 2) && <Conversation c={c} revealed={act === 1 ? 1 : 3} reasoning={act === 1 ? null : PITCH_REASONING.before} now={act === 1 ? PITCH_REASONING.before : PITCH_REASONING.after} />}
        {act === 3 && <Result c={c} />}
        {act === 4 && <Control c={c} />}
      </div>

      <footer className="pd-foot">
        <button type="button" className="ws-btn" onClick={() => go(act - 1)} disabled={act === 0}>← Back</button>
        <span className="ws-small ws-muted">{act + 1} / {ACTS.length} · arrow keys work</span>
        <button type="button" className="ws-btn ws-btn-primary" onClick={() => go(act + 1)} disabled={act === last}>Next →</button>
      </footer>

      <HowItWorks />
    </main>
  );
}

/* ---------- Act 1 ---------- */

function Problem() {
  const pieces = [
    { k: "Account", v: "Transactions in one system" },
    { k: "Customer", v: "Their story in call notes" },
    { k: "Evidence", v: "Device, identity and risk signals elsewhere" },
    { k: "Rules", v: "Regulation E and bank policy in a binder" },
  ];
  return (
    <div className="pd-problem">
      <ul className="pd-pieces" aria-label="Today">
        {pieces.map((p) => (
          <li key={p.k}><strong>{p.k}</strong><span>{p.v}</span></li>
        ))}
      </ul>
      <p className="pd-arrow" aria-hidden="true">→</p>
      <div className="pd-promise">
        <p className="pd-promise-text">From a customer&apos;s account to a complete, evidence-backed claim recommendation, with a human authorizing the outcome.</p>
      </div>
    </div>
  );
}

/* ---------- Acts 2 and 3 ---------- */

function Conversation({ c, revealed, reasoning, now }: { c: PitchCase; revealed: number; reasoning: PitchReasoning | null; now: PitchReasoning }) {
  const record = c.transactions.find((t) => t.ref === PITCH_MATCHED_REF)!;
  const turns = PITCH_TURNS.slice(0, revealed);
  return (
    <div className="pd-convo">
      <ol className="pd-chat" aria-label="Conversation">
        {turns.map((t, i) => (
          <li key={t.ref} className="pd-chat-group">
            {t.answers && <p className="pd-bubble pd-agent">{t.answers.text}</p>}
            <p className={`pd-bubble pd-customer${i === 1 && revealed > 1 ? " pd-pivot" : ""}`}>{t.text}</p>
            {i === 0 && (
              <div className="pd-found">
                <span className="pd-eyebrow">Found on the account</span>
                <span className="pd-found-row"><strong>{usd(record.amount)}</strong> {record.merchantName} <span className="ws-muted">· {record.date}</span></span>
              </div>
            )}
          </li>
        ))}
        {revealed === 1 && <li><p className="pd-bubble pd-agent pd-asking">{now.nextQuestion}</p></li>}
      </ol>

      <aside className="pd-mind" aria-label="Agent's working interpretation">
        <span className="pd-eyebrow">Working interpretation</span>
        {reasoning && <p className="pd-was"><s>{reasoning.interpretation}</s></p>}
        <p className="pd-now">{now.interpretation}</p>
        <span className="pd-eyebrow">Investigation it planned</span>
        <ol className="pd-work">
          {now.work.map((w) => {
            const was = reasoning?.work.find((x) => x.key === w.key);
            const changed = !!reasoning && (!was || was.status !== w.status);
            const done = w.status === "done";
            return (
              <li key={w.key} data-status={w.status} data-changed={changed || undefined}>
                <span className="pd-work-mark" aria-hidden="true" />
                <span>{done ? w.doneTitle ?? w.title : w.title}{!done && <em> · awaiting the customer</em>}{done && w.outcome && <span className="pd-work-out"> {w.outcome}</span>}</span>
              </li>
            );
          })}
        </ol>
        <div className="pd-next">
          <span className="pd-eyebrow">Next step it chose</span>
          <p>Ask: “{now.nextQuestion}”</p>
          <p className="ws-small ws-muted">{now.why}</p>
        </div>
        {reasoning && <p className="pd-callout">Not approved. Not excluded. Still investigating.</p>}
      </aside>
    </div>
  );
}

/* ---------- Act 4 ---------- */

function Result({ c }: { c: PitchCase }) {
  const [open, setOpen] = useState<{ ref: string; where: "why" | "rules" } | null>(null);
  const p = c.proposal;
  const chip = (ref: string, where: "why" | "rules") => {
    const on = open?.ref === ref && open.where === where;
    return <button key={ref} type="button" className="pd-ref" aria-expanded={on} onClick={() => setOpen(on ? null : { ref, where })}>{ref}</button>;
  };
  const note = (ref: string) => p.legalBasis.find((l) => l.sourceRef === ref)?.note;
  return (
    <div className="pd-result">
      <section className="pd-card pd-disposition" aria-label="Proposed disposition">
        <span className="pd-eyebrow">Proposed disposition</span>
        <h2>{DECISION_LABEL[p.decision]}</h2>
        <p>{p.summary}</p>
        <p className="pd-plan">{c.plan.note}</p>
      </section>

      <section className="pd-card" aria-label="Why">
        <span className="pd-eyebrow">Why · tap a reference for the evidence</span>
        <ul className="pd-why">
          {p.rationale.map((r) => (
            <li key={r.point}>{r.point} <span className="pd-refs">{r.refs.map((x) => chip(x, "why"))}</span></li>
          ))}
        </ul>
        {open?.where === "why" && <Evidence c={c} refId={open.ref} />}
      </section>

      <div className="pd-row">
        <section className="pd-card" aria-label="Rules considered">
          <span className="pd-eyebrow">Rules considered</span>
          <ul className="pd-legal">
            {p.legalBasis.map((l) => (
              <li key={l.sourceRef}>
                <span className={`pd-reading pd-reading-${l.reading}`}>{READING_LABEL[l.reading]}</span> {chip(l.sourceRef, "rules")}
              </li>
            ))}
          </ul>
          {open?.where === "rules" && <Evidence c={c} refId={open.ref} reading={note(open.ref)} />}
        </section>
        <section className="pd-card" aria-label="Prepared outputs">
          <span className="pd-eyebrow">Prepared for the reviewer</span>
          {p.documents.map((d) => (
            <details key={d.kind} className="pd-doc">
              <summary>{DOC_LABEL[d.kind]}</summary>
              <p className="ws-small">{d.text}</p>
            </details>
          ))}
        </section>
      </div>

      <section className="pd-guards" aria-label="Checked by code">
        <span className="pd-eyebrow">Checked by code</span>
        <ul>
          {c.guardrails.map((g) => (
            <li key={g.label} title={g.detail} data-failed={!g.passed || undefined}>{g.passed ? "✓" : "✕"} {g.label}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Evidence({ c, refId, reading }: { c: PitchCase; refId: string; reading?: string }) {
  const r = resolveRef(c, refId);
  return (
    <div className="pd-evidence" role="region" aria-label={`Evidence ${refId}`}>
      {r.kind === "statement" && (<><span className="pd-eyebrow">{refId} · customer said</span><p>“{r.text}”</p></>)}
      {r.kind === "transaction" && (<><span className="pd-eyebrow">{refId} · bank record (fixture)</span><p>{usd(r.txn.amount)} · {r.txn.merchantName} · {r.txn.date} · {r.txn.status}</p></>)}
      {r.kind === "regulatory" && (
        <>
          <span className="pd-eyebrow">{r.source.citation}</span>
          {reading && <p><strong>Model&apos;s reading:</strong> {reading}</p>}
          <p className="ws-small">{r.source.excerpt}</p>
        </>
      )}
      {r.kind === "unknown" && <p className="ws-error-text">Unknown reference.</p>}
    </div>
  );
}

/* ---------- Act 5 ---------- */

type Outcome = { kind: "authorized" } | { kind: "overridden"; to: ProposedDecision; reason: string } | { kind: "returned"; note: string };

function Control({ c }: { c: PitchCase }) {
  const [mode, setMode] = useState<"idle" | "override" | "return">("idle");
  const [to, setTo] = useState<ProposedDecision>("request_information");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const failedAuto = c.autoApproval.checks.filter((x) => !x.passed).length;

  const submit = () => {
    if (!text.trim()) return setError(mode === "override" ? "An override needs a reason." : "Say what the agent should look into.");
    setError("");
    setOutcome(mode === "override" ? { kind: "overridden", to, reason: text.trim() } : { kind: "returned", note: text.trim() });
    setMode("idle");
    setText("");
  };

  return (
    <div className="pd-control">
      <section className="pd-card pd-decide" aria-label="Your decision">
        <span className="pd-eyebrow">In the specialist&apos;s queue · proposed handling</span>
        <h2>{DECISION_LABEL[c.proposal.decision]}</h2>
        <p className="ws-small ws-muted">The specialist decides the outcome: keep the proposed handling, decide differently, or send it back.</p>
        <div className="pd-actions">
          <button type="button" className="ws-btn ws-btn-primary" onClick={() => { setOutcome({ kind: "authorized" }); setMode("idle"); }}>Authorize</button>
          <button type="button" className="ws-btn" aria-pressed={mode === "override"} onClick={() => setMode(mode === "override" ? "idle" : "override")}>Override</button>
          <button type="button" className="ws-btn" aria-pressed={mode === "return"} onClick={() => setMode(mode === "return" ? "idle" : "return")}>Return to agent</button>
        </div>
        {mode !== "idle" && (
          <div className="pd-form">
            {mode === "override" && (
              <label className="ws-field">
                <span className="ws-small">Decide instead</span>
                <select value={to} onChange={(e) => setTo(e.target.value as ProposedDecision)}>
                  {PROPOSED_DECISIONS.filter((d) => d !== c.proposal.decision).map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
                </select>
              </label>
            )}
            <label className="ws-field">
              <span className="ws-small">{mode === "override" ? "Reason (required)" : "What should the agent look into?"}</span>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error || undefined} />
            </label>
            {error && <p className="ws-small ws-error-text">{error}</p>}
            <button type="button" className="ws-btn ws-btn-sm" onClick={submit}>{mode === "override" ? "Record override" : "Send back"}</button>
          </div>
        )}
        <p className="pd-outcome" role="status" aria-live="polite">
          {outcome?.kind === "authorized" && <>Authorized. The customer letter and information request go out; the case stays open with the specialist. <span className="ws-muted">(Demo, not saved.)</span></>}
          {outcome?.kind === "overridden" && <>Overridden to “{DECISION_LABEL[outcome.to]}”: {outcome.reason}.{outcome.to === "deny" ? " A written explanation goes to the customer." : ""} <span className="ws-muted">(Demo, not saved.)</span></>}
          {outcome?.kind === "returned" && <>Returned to the agent: “{outcome.note}”. It picks the next step from there. <span className="ws-muted">(Demo, not saved.)</span></>}
        </p>
      </section>

      <ul className="pd-limits">
        <li><strong>Denials</strong> always need a person.</li>
        <li><strong>Payouts</strong> happen only under policy AUTO-1: $100 or less, every check passing.</li>
        <li>
          <strong>Here,</strong> even a proposal to approve would wait for a person: AUTO-1 fails {failedAuto} checks
          {c.ifApproved.plan.kind === "needs_person_to_approve" ? "" : " (unexpected)"}, starting with “the customer made the payment”.
        </li>
      </ul>
    </div>
  );
}

/* ---------- Disclosure ---------- */

function HowItWorks() {
  return (
    <details className="pd-how">
      <summary>What&apos;s real in this demo</summary>
      <ul className="ws-small">
        <li><strong>Scripted for reliability:</strong> the customer&apos;s lines and the model&apos;s interpretations, questions and proposal are prewritten. No model, Convex or Nessie call is made, and nothing is saved.</li>
        <li><strong>Real code:</strong> the record match, the proposal validator, the execution rules and policy AUTO-1 run on that script in your browser.</li>
        <li><strong>In the app:</strong> the reasoning model (Bitdeer) reassesses each case whenever it changes: its findings, hypotheses, the investigative work it plans, the next question and the proposed disposition. Code validates every assessment and records what changed; the fixed rules are a guardrail and the fallback when the model is off. Built and mock-tested; not yet run against the live model.</li>
        <li><strong>Not built yet:</strong> saving overrides and returns on live cases (approving or confirming a model proposal is built), and sign-in.</li>
      </ul>
      <p className="ws-small"><Link href="/review">Open the live claims queue →</Link></p>
    </details>
  );
}
