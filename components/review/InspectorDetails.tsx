"use client";

/**
 * Detail views for one selected item: its source and version, how it was read, and everything in
 * the case that cites it. Every relationship shown is read from stored data; a ref the case does
 * not hold is shown as missing.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { ExternalLink } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { RECOMMENDATION_LABEL } from "@/lib/domain/triage";
import { citersOf, conditionsFor, evidenceDetail, policySummary, registryRuleText, ruleDetail, type Citers, type Selection } from "@/lib/review/inspector";
import { BASIS_LABEL, DECISION_LABEL, DOC_AUDIENCE, DOC_LABEL, HYPOTHESIS_LABEL, PAYOUT_LABEL, PLAN_LABEL, READING_LABEL, WORK_STATUS_LABEL, humanize, policyLabel } from "@/lib/review/labels";
import { RECONCILIATION_LABEL, SOURCE_KIND_LABEL } from "@/lib/review/workspace";
import { RefChip, RefChips, refKindLabel } from "./EvidenceRef";
import { CREDENTIALS_LABEL, POSITION_LABEL, clockTime, exactTime, shortKey, shortRef, usd } from "./format";
import { Mark, Pill, errorText, type Tone } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const CONDITION: Record<string, { label: string; tone: Tone }> = {
  supported_by_customer_statement: { label: "Reported", tone: "warn" },
  supported_by_record: { label: "Shown by a record", tone: "ok" },
  contradicted: { label: "Contradicted", tone: "crit" },
  unresolved: { label: "Unresolved", tone: "quiet" },
};

type R = [string, React.ReactNode];

function Head({ kicker, title, pills }: { kicker: string; title: string; pills?: React.ReactNode }) {
  return (
    <header className="ins-head">
      <span className="eyebrow">{kicker}</span>
      <h2>{title}</h2>
      {pills && <div className="ins-pills">{pills}</div>}
    </header>
  );
}

function Rows({ rows }: { rows: R[] }) {
  return (
    <dl className="ins-rows">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ins-sect">
      <span className="eyebrow">{title}</span>
      {children}
    </section>
  );
}

function CitedBy({ c }: { c: Citers }) {
  const { select } = useWorkspace();
  const none = c.findings.length + c.hypotheses.length + c.work.length + c.rationale.length + c.conditions.length === 0;
  if (none) return null;
  return (
    <>
      {c.findings.length > 0 && (
        <Section title="Findings">
          <ul className="ins-list">
            {c.findings.map((f) => (
              <li key={f.index}>
                <button type="button" className="link" onClick={() => select({ kind: "finding", index: f.index })}>
                  {f.text}
                </button>{" "}
                <span className="muted small">· {BASIS_LABEL[f.basis]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.rationale.length > 0 && (
        <Section title="Rationale">
          <ul className="ins-list">
            {c.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Section>
      )}
      {c.hypotheses.length > 0 && (
        <Section title="Interpretations">
          <ul className="ins-list">
            {c.hypotheses.map((h) => (
              <li key={h.index}>
                <button type="button" className="link" onClick={() => select({ kind: "hypothesis", index: h.index })}>
                  {h.text}
                </button>{" "}
                <span className="muted small">· {HYPOTHESIS_LABEL[h.status]}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.work.length > 0 && (
        <Section title="Work">
          <ul className="ins-list">
            {c.work.map((w) => (
              <li key={w.key}>
                <button type="button" className="link" onClick={() => select({ kind: "work", key: w.key })}>
                  {w.title}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.conditions.length > 0 && (
        <Section title="Conditions">
          <ul className="ins-list">
            {c.conditions.map((k, i) => (
              <li key={i}>
                <Pill tone={CONDITION[k.status]?.tone ?? "neutral"}>{CONDITION[k.status]?.label ?? humanize(k.status)}</Pill> {k.text}{" "}
                <button type="button" className="link small" onClick={() => select({ kind: "rule", ref: k.sourceRef })}>
                  {k.citation}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export function Detail({ selection }: { selection: Selection }) {
  switch (selection.kind) {
    case "evidence":
      return <EvidenceDetailView refId={selection.ref} />;
    case "finding":
      return <FindingDetail index={selection.index} />;
    case "uncertainty":
      return <UncertaintyDetail index={selection.index} />;
    case "hypothesis":
      return <HypothesisDetail index={selection.index} />;
    case "rule":
      return <RuleDetailView refId={selection.ref} />;
    case "registry":
      return <RegistryDetail id={selection.id} />;
    case "policy":
      return <PolicyDetail />;
    case "work":
      return <WorkDetail workKey={selection.key} />;
    case "disposition":
      return <DispositionDetail />;
    case "outcome":
      return <OutcomeDetail />;
    case "question":
      return <QuestionDetail />;
    case "document":
      return <DocumentDetail index={selection.index} />;
    case "action":
      return <ActionDetail id={selection.id} />;
    case "assessment":
      return <AssessmentDetail id={selection.id} />;
  }
}

// ---------- Evidence ----------

function EvidenceDetailView({ refId }: { refId: string }) {
  const { ws } = useWorkspace();
  const e = evidenceDetail(ws.data, ws.analysis, refId);
  const citers = citersOf(refId, ws.status, ws.proposal, ws.analysis);
  if (e.kind === "statement") {
    const s = e.statement;
    const i = s.interpretation;
    return (
      <>
        <Head kicker={`Statement · ${s.ref}`} title={`“${s.text}”`} pills={<><Mark kind="reported" /><span className="tag">{s.channel}</span></>} />
        <Rows
          rows={[
            ["Received", exactTime(s.receivedAt)],
            ...(s.inResponseTo ? [["In reply to", <>“{s.inResponseTo.text}” <code className="muted">{shortKey(s.inResponseTo.key)}</code>{s.answer && <> · {humanize(s.answer.state)}</>}</>] as R] : []),
            ...(s.correctsRef ? [["Corrects", <RefChip key="c" refId={s.correctsRef} />] as R] : []),
            ...(e.superseded ? [["Superseded", <>{e.superseded.fields.map(humanize).join(", ")} by <RefChip refId={e.superseded.by} /></>] as R] : []),
            ...(s.redactions?.length ? [["Removed", s.redactions.map(humanize).join(", ")] as R] : []),
          ]}
        />
        <Section title="Read as">
          {s.interpretationStatus === "pending" && <p className="small muted">Pending.</p>}
          {s.interpretationStatus === "failed" && (
            <p className="small error">
              Failed{s.interpretationError ? `: ${s.interpretationError}` : ""}.{ws.mode === "live" && <RetryInterpretation statementId={s._id} />}
            </p>
          )}
          {i && (
            <Rows
              rows={[
                ["By", <span key="rb" className={`tag ${i.mode === "live" ? "tag-live" : ""}`}>{i.mode === "live" ? i.provider : "rules"}</span>],
                ...(i.amounts.length ? [["Amounts", i.amounts.map(usd).join(", ")] as R] : []),
                ...(i.dates.length ? [["Dates", i.dates.join(", ")] as R] : []),
                ...(i.merchantTerms.length ? [["Payee", i.merchantTerms.join(", ")] as R] : []),
                ...(i.authorization !== "unspecified" ? [["Position", POSITION_LABEL[i.authorization]] as R] : []),
                ...(i.credentialSharing !== "unspecified" ? [["Credentials", CREDENTIALS_LABEL[i.credentialSharing]] as R] : []),
                ...(i.scamIndicators.length ? [["Scam signs", i.scamIndicators.join(", ")] as R] : []),
              ]}
            />
          )}
        </Section>
        <CitedBy c={citers} />
      </>
    );
  }
  if (e.kind === "transaction") {
    const t = e.transaction;
    const o = e.origin;
    return (
      <>
        <Head kicker={`Bank record · ${shortRef(t.ref)}`} title={`${usd(t.amount)} · ${t.merchantName ?? t.description ?? "unknown payee"}`} pills={<><Mark kind="observed" /><Pill tone={e.reconciliation === "confirmed" || e.reconciliation === "matched" ? "ok" : e.reconciliation === "excluded" ? "quiet" : "warn"}>{RECONCILIATION_LABEL[e.reconciliation]}</Pill></>} />
        <Rows
          rows={[
            ["Date", t.date ?? "unknown"],
            ["Kind", `${t.kind}${t.medium ? ` · ${t.medium}` : ""}`],
            ["Status", t.status ?? "unknown"],
            ["Source", ws.mode === "demo" ? "Fixture" : `Nessie · ${exactTime(t.retrievedAt)}`],
            ["Record id", <code key="id">{t.externalId}</code>],
            ...(e.excludedReason ? [["Excluded", e.excludedReason] as R] : []),
          ]}
        />
        <Section title="Payment origin">
          {o ? (
            <Rows rows={[["Channel", humanize(o.channel)], ["Device", humanize(o.device)], ["Two-factor", humanize(o.twoFactor)], ["Place", `${o.city}, ${o.state}`], ["Source", <span key="s" className="tag tag-demo">Synthetic · {o.preset}</span>]]} />
          ) : (
            <p className="small muted">None attached.</p>
          )}
        </Section>
        <CitedBy c={citers} />
      </>
    );
  }
  if (e.kind === "provider") {
    const r = e.row;
    return (
      <>
        <Head kicker={`Provider fact · ${r.provider}`} title={`${humanize(r.field)}: ${r.value}`} pills={<><Mark kind="observed" />{r.syntheticAssociation && <span className="tag tag-demo">synthetic association</span>}</>} />
        <Rows rows={[["Product", r.product], ["Retrieved", exactTime(r.retrievedAt)], ["Reference", <code key="r">{r.ref}</code>]]} />
        <CitedBy c={citers} />
      </>
    );
  }
  if (e.kind === "regulatory") return <RuleDetailView refId={refId} />;
  return (
    <>
      <Head kicker={refKindLabel(refId)} title={refId} pills={<Pill tone="crit">{e.superseded ? "Superseded" : "Missing"}</Pill>} />
      <CitedBy c={citers} />
    </>
  );
}

function RetryInterpretation({ statementId }: { statementId: Id<"statements"> }) {
  const retry = useMutation(api.statements.retryLive);
  const scripted = useMutation(api.statements.interpretScriptedExplicitly);
  const [error, setError] = useState<string | null>(null);
  const run = (f: () => Promise<unknown>) => f().catch((e) => setError(errorText(e)));
  return (
    <span className="ins-actions">
      <button type="button" className="btn btn-sm" onClick={() => run(() => retry({ statementId }))}>
        Retry
      </button>
      <button type="button" className="btn btn-sm" onClick={() => run(() => scripted({ statementId }))}>
        Scripted reader
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}

// ---------- Findings, uncertainties, hypotheses, work ----------

function FindingDetail({ index }: { index: number }) {
  const { ws, select } = useWorkspace();
  const f = ws.status.investigation.findings[index];
  if (!f) return <p className="muted small">Not in the current assessment.</p>;
  const conditions = conditionsFor(ws.analysis, f.refs);
  const rationale = ws.proposal?.rationale.filter((r) => r.refs.some((x) => f.refs.includes(x))) ?? [];
  return (
    <>
      <Head kicker="Finding" title={f.text} pills={<Mark kind={f.basis === "corroborated" ? "observed" : "reported"} label={BASIS_LABEL[f.basis]} />} />
      <Section title="Evidence">
        <RefChips refs={f.refs} withSources />
      </Section>
      {rationale.length > 0 && (
        <Section title="In the proposal">
          <ul className="ins-list">
            {rationale.map((r) => (
              <li key={r.point}>{r.point}</li>
            ))}
          </ul>
        </Section>
      )}
      {conditions.length > 0 && (
        <Section title="Conditions">
          <ul className="ins-list">
            {conditions.map((k, i) => (
              <li key={i}>
                <Pill tone={CONDITION[k.status]?.tone ?? "neutral"}>{CONDITION[k.status]?.label ?? humanize(k.status)}</Pill> {k.text}{" "}
                <button type="button" className="link small" onClick={() => select({ kind: "rule", ref: k.sourceRef })}>
                  {k.citation}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function UncertaintyDetail({ index }: { index: number }) {
  const { ws, select } = useWorkspace();
  const u = ws.status.investigation.uncertainties[index];
  if (!u) return <p className="muted small">No longer open.</p>;
  const waiting = ws.status.work.filter((w) => w.status === "awaiting_customer" || w.status === "awaiting_bank" || w.status === "in_progress");
  return (
    <>
      <Head kicker="Open point" title={u.text} pills={u.blocking ? <Mark kind="blocking" className="mark-crit" /> : <Pill tone="quiet">Not blocking</Pill>} />
      {ws.status.nextQuestion && (
        <Section title="Next question">
          <button type="button" className="link" onClick={() => select({ kind: "question" })}>
            “{ws.status.nextQuestion}”
          </button>
        </Section>
      )}
      {waiting.length > 0 && (
        <Section title="Work under way">
          <ul className="ins-list">
            {waiting.map((w) => (
              <li key={w.key}>
                <button type="button" className="link" onClick={() => select({ kind: "work", key: w.key })}>
                  {w.title}
                </button>{" "}
                <span className="muted small">· {WORK_STATUS_LABEL[w.status].toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function HypothesisDetail({ index }: { index: number }) {
  const { ws } = useWorkspace();
  const h = ws.status.investigation.hypotheses[index];
  if (!h) return <p className="muted small">No longer listed.</p>;
  return (
    <>
      <Head kicker="Interpretation" title={h.text} pills={<Pill tone={h.status === "supported" ? "ok" : h.status === "ruled_out" ? "quiet" : "warn"}>{HYPOTHESIS_LABEL[h.status]}</Pill>} />
      <Section title="Evidence">{h.refs.length ? <RefChips refs={h.refs} withSources /> : <p className="small muted">None cited.</p>}</Section>
    </>
  );
}

function WorkDetail({ workKey }: { workKey: string }) {
  const { ws } = useWorkspace();
  const w = ws.status.work.find((x) => x.key === workKey);
  if (!w) return <p className="muted small">No longer in the plan.</p>;
  const done = w.status === "done";
  return (
    <>
      <Head kicker="Work" title={done ? (w.doneTitle ?? w.title) : w.title} pills={<Pill tone={done ? "ok" : w.status === "not_needed" ? "quiet" : "warn"}>{WORK_STATUS_LABEL[w.status]}</Pill>} />
      <Rows rows={[["Checks", w.detail], ...(w.outcome ? [["Outcome", w.outcome] as R] : [])]} />
      <Section title="Evidence">{w.refs.length ? <RefChips refs={w.refs} withSources /> : <p className="small muted">None yet.</p>}</Section>
    </>
  );
}

// ---------- Rules and policy ----------

function RuleDetailView({ refId }: { refId: string }) {
  const { ws } = useWorkspace();
  const r = ruleDetail(ws.analysis, ws.proposal, refId);
  const s = r.source;
  return (
    <>
      <Head kicker={s ? SOURCE_KIND_LABEL[s.kind] : "Source"} title={s?.citation ?? refId} pills={<>{r.reading && <Pill tone={r.reading.reading === "likely_applies" ? "ok" : r.reading.reading === "unclear" ? "warn" : "quiet"}>{READING_LABEL[r.reading.reading]}</Pill>}{s && !s.verbatimVerified && <Pill tone="warn">Paraphrased</Pill>}</>} />
      {s ? (
        <>
          <p className="small">{s.title}</p>
          <blockquote className="ins-quote">{s.excerpt}</blockquote>
          <Rows
            rows={[
              ["Reviewed", s.reviewedOn],
              ["Applies when", s.applicability],
              ["Source", s.url.startsWith("http") ? <a key="u" href={s.url} target="_blank" rel="noreferrer">{s.url.replace(/^https?:\/\//, "").slice(0, 44)}… <ExternalLink size={12} aria-hidden="true" /></a> : s.url],
            ]}
          />
        </>
      ) : (
        <p className="small error">Not a curated source.</p>
      )}
      {r.reading && (
        <Section title="Model's reading">
          <p className="small">{r.reading.note}</p>
        </Section>
      )}
      {r.consideration && (
        <Section title="Conditions">
          <ul className="ins-list">
            {r.consideration.conditions.map((k, i) => (
              <li key={i}>
                <Pill tone={CONDITION[k.status]?.tone ?? "neutral"}>{CONDITION[k.status]?.label ?? humanize(k.status)}</Pill> {k.text} <RefChips refs={k.refs} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function RegistryDetail({ id }: { id: string }) {
  const { ws } = useWorkspace();
  const r = registryRuleText(id);
  const why = ws.proposal?.investigation.rulesConsulted.find((x) => x.ruleId === id)?.why;
  return (
    <>
      <Head kicker="Reference rule" title={r ? r.rule : id} pills={<Pill tone="quiet">Reference only</Pill>} />
      {r ? <Rows rows={[["Claim type", r.claimType], ["Obligation", r.obligation], ["Human review", r.humanReview || "—"]]} /> : <p className="small error">Not in the registry.</p>}
      {why && (
        <Section title="Why it was used">
          <p className="small">{why}</p>
        </Section>
      )}
    </>
  );
}

function PolicyDetail() {
  const { ws } = useWorkspace();
  const p = policySummary(ws.auto);
  if (!p) return <p className="muted small">Not evaluated yet.</p>;
  const label = policyLabel(p.policy);
  return (
    <>
      <Head kicker="Policy" title={label.name} pills={<>{label.version && <Pill tone="quiet">v{label.version}</Pill>}<Pill tone={p.eligible ? "ok" : "quiet"}>{p.passed} of {p.total} pass</Pill></>} />
      <ul className="ins-checks">
        {p.checks.map((c) => (
          <li key={c.id} data-passed={c.passed || undefined}>
            <span className="ins-check-mark" aria-hidden="true">
              {c.passed ? "✓" : "✕"}
            </span>
            <span>
              <strong>{c.label}</strong>
              <span className="row-note">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- Disposition, outcome, question, documents ----------

function DispositionDetail() {
  const { ws, select } = useWorkspace();
  const { proposal, status, analysis, history } = ws;
  const d = status.disposition;
  const row = history.find((h) => h.status === "done");
  if (!proposal) return <p className="muted small">No proposal.</p>;
  const blocking = proposal.investigation.uncertainties.filter((u) => u.blocking);
  return (
    <>
      <Head kicker="Proposed" title={DECISION_LABEL[proposal.decision]} pills={<>{d?.plan && <Pill tone="quiet">{PLAN_LABEL[d.plan.kind] ?? d.plan.kind}</Pill>}{d && !d.current && <Pill tone="warn">Case changed since</Pill>}</>} />
      <p className="small">{proposal.summary}</p>
      <Section title="Rationale">
        <ol className="ins-list">
          {proposal.rationale.map((r, i) => (
            <li key={i}>
              {r.point} <RefChips refs={r.refs} withSources />
            </li>
          ))}
        </ol>
      </Section>
      {proposal.legalBasis.length > 0 && (
        <Section title="Readings">
          <ul className="ins-list">
            {proposal.legalBasis.map((l) => (
              <li key={l.sourceRef}>
                <Pill tone={l.reading === "likely_applies" ? "ok" : l.reading === "unclear" ? "warn" : "quiet"}>{READING_LABEL[l.reading]}</Pill>{" "}
                <button type="button" className="link" onClick={() => select({ kind: "rule", ref: l.sourceRef })}>
                  {l.sourceRef}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {blocking.length > 0 && (
        <Section title="Blocking">
          <ul className="ins-list">
            {blocking.map((u) => (
              <li key={u.text}>{u.text}</li>
            ))}
          </ul>
        </Section>
      )}
      {row && row.problems.length > 0 && (
        <Section title="Dropped by validation">
          <ul className="ins-list small">
            {row.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>
      )}
      {analysis && (
        <Section title="Rule-based route">
          <p className="small">{RECOMMENDATION_LABEL[analysis.recommendation.action]}</p>
        </Section>
      )}
    </>
  );
}

function OutcomeDetail() {
  const { ws } = useWorkspace();
  const o = ws.status.outcome;
  const dec = ws.data.decisions[0] ?? null;
  if (!o) return <p className="muted small">Nothing authorized.</p>;
  return (
    <>
      <Head kicker="Authorized" title={o.label} pills={<Mark kind={o.by === "policy" ? "policy" : "person"} />} />
      {dec && (
        <Rows
          rows={[
            ["Decided", exactTime(dec.decidedAt)],
            ["By", dec.outcome === "auto_approved" ? `${policyLabel(dec.policy).name}${policyLabel(dec.policy).version ? ` v${policyLabel(dec.policy).version}` : ""}` : "A person"],
            ["Amount", usd(dec.amount)],
            ["Record", <RefChip key="r" refId={dec.txnRef} />],
            ["Checks", `${dec.checks.filter((c) => c.passed).length} of ${dec.checks.length} passed`],
            ["Payout", `${PAYOUT_LABEL[dec.payout.status]}${dec.payout.depositId ? ` · ${dec.payout.depositId.slice(0, 8)}…` : ""}${dec.payout.error ? ` · ${dec.payout.error}` : ""}`],
            ...(dec.needsReview ? [["Flagged", `${exactTime(dec.needsReview.at)} · ${dec.needsReview.reason}`] as R] : []),
            ...(dec.needsReview?.review ? [["Reviewed", `${exactTime(dec.needsReview.review.at)} · ${dec.needsReview.review.affirmed ? "affirmed" : "kept flagged"}${dec.needsReview.review.note ? ` · “${dec.needsReview.review.note}”` : ""}`] as R] : []),
          ]}
        />
      )}
      {o.override && <Rows rows={[["Decided", exactTime(o.override.at)], ["Reason", o.override.reason]]} />}
    </>
  );
}

function QuestionDetail() {
  const { ws } = useWorkspace();
  const q = ws.status.nextQuestion;
  if (!q) return <p className="muted small">No question waiting.</p>;
  const action = ws.status.nextQuestionBy === "reviewer" ? ws.status.lastAction : null;
  const blocking = ws.status.investigation.uncertainties.filter((u) => u.blocking);
  return (
    <>
      <Head kicker="Next question" title={`“${q}”`} pills={<Mark kind={ws.status.nextQuestionBy === "reviewer" ? "person" : "model"} />} />
      {action && (
        <Section title="Reason">
          <p className="small">{action.reason}</p>
        </Section>
      )}
      {!action && blocking.length > 0 && (
        <Section title="Settles">
          <ul className="ins-list">
            {blocking.map((u) => (
              <li key={u.text}>{u.text}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function DocumentDetail({ index }: { index: number }) {
  const { ws } = useWorkspace();
  const doc = ws.proposal?.documents[index];
  if (!doc) return <p className="muted small">No such document.</p>;
  const stale = !!ws.accepted && !ws.accepted.current;
  return (
    <>
      <Head kicker={DOC_AUDIENCE[doc.kind]} title={DOC_LABEL[doc.kind]} pills={<Pill tone={stale ? "warn" : "quiet"}>{stale ? "Needs reassessment" : "Draft"}</Pill>} />
      <p className="ins-doc prewrap">{doc.text}</p>
    </>
  );
}

function ActionDetail({ id }: { id: string }) {
  const { ws } = useWorkspace();
  const a = ws.data.reviewActions.find((x) => x._id === id);
  if (!a) return <p className="muted small">Not found.</p>;
  return (
    <>
      <Head kicker="Reviewer action" title={a.kind === "override" ? `Decided differently: ${a.decision ? DECISION_LABEL[a.decision] : ""}` : a.kind === "return" ? "Returned to the investigator" : "Note"} pills={<Mark kind="person" />} />
      <Rows rows={[["When", exactTime(a.at)], [a.kind === "return" ? "Requested" : "Reason", a.reason], ...(a.question ? [["Question", a.question] as R] : [])]} />
    </>
  );
}

function AssessmentDetail({ id }: { id: string }) {
  const { ws } = useWorkspace();
  const h = ws.history.find((x) => x._id === id);
  if (!h) return <p className="muted small">Not found.</p>;
  const title = h.status === "done" ? (h.decision ? `Proposed: ${DECISION_LABEL[h.decision as keyof typeof DECISION_LABEL] ?? h.decision}` : "Assessment") : h.status === "pending" ? "Reassessing" : h.status === "failed" ? "Model call failed" : "Rejected by validation";
  return (
    <>
      <Head kicker="Assessment" title={title} pills={<>{h.current && h.status === "done" && <Pill tone="accent">current</Pill>}<Pill tone="quiet">{h.trigger === "manual" ? "asked by a reviewer" : "case changed"}</Pill></>} />
      <Rows rows={[["Requested", exactTime(h.requestedAt)], ["Completed", h.status === "pending" ? "—" : exactTime(h.completedAt)], ["Provider", h.provider ?? "—"]]} />
      {h.changeLog.length > 0 && (
        <Section title="Changes">
          <ul className="ins-list">
            {h.changeLog.map((c, i) => (
              <li key={i}>{c.text}</li>
            ))}
          </ul>
        </Section>
      )}
      {h.error && <p className="small error">{h.error}</p>}
      {h.problems.length > 0 && (
        <Section title={h.status === "rejected_by_validation" ? "Rejected because" : "Dropped by validation"}>
          <ul className="ins-list small">
            {h.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>
      )}
      {h.resolution && (
        <Section title="Answer">
          <p className="small">
            {h.resolution.accepted ? "Authorized" : "Rejected"} {clockTime(h.resolution.at)}
            {h.resolution.note ? ` · “${h.resolution.note}”` : ""}
          </p>
        </Section>
      )}
    </>
  );
}
