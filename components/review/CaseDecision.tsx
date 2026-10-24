"use client";

/**
 * Case decision panel (live cases): the reasoning model's proposal, who has to act on it, and the
 * controls for a person when one is needed. Approvals within policy AUTO-1 and requests for
 * information happen without a person; denials and other approvals wait for one.
 */
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getSource } from "@/lib/domain/regulatory";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import { RECOMMENDATION_LABEL, type StoredAnalysis } from "@/lib/domain/triage";
import { RefChip } from "./EvidenceRef";
import { exactTime, usd } from "./format";

const DECISION_LABEL: Record<CaseProposal["decision"], string> = {
  approve: "Approve reimbursement",
  deny: "Deny the claim",
  request_information: "Ask the customer for more information",
  escalate: "Escalate to a specialist",
};

const PLAN_LABEL: Record<string, string> = {
  automatic: "Applied automatically",
  auto_approved: "Approved automatically (AUTO-1)",
  needs_person_to_approve: "Waiting for a person to approve",
  needs_person_to_confirm_denial: "Waiting for a person to confirm",
};

const READING_LABEL = { likely_applies: "Likely applies", likely_does_not_apply: "Likely does not apply", unclear: "Unclear" } as const;

export function CaseDecisionPanel({ caseId, analysis, decisions }: { caseId: Id<"cases">; analysis: StoredAnalysis | null; decisions: Doc<"reimbursementDecisions">[] }) {
  const data = useQuery(api.proposals.latest, { caseId });
  const ask = useMutation(api.proposals.requestProposal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = data?.proposal ?? null;
  const proposal = (p?.proposal ?? null) as CaseProposal | null;

  const askNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask({ caseId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ws-casedecision" aria-labelledby="decision-h">
      <h3 id="decision-h" className="ws-eyebrow">Case decision</h3>

      {decisions.map((d) => <DecisionRecord key={d._id} d={d} />)}

      {data === undefined ? (
        <p className="ws-small ws-muted">Loading…</p>
      ) : !p ? (
        <p className="ws-small ws-muted">
          {data.enabled ? "The reasoning model is asked when the case reaches a decision point (nothing blocking left)." : "Case reasoning is off on this deployment (scripted mode), so only the rule-based route below applies."}
        </p>
      ) : p.status === "pending" ? (
        <p className="ws-small" role="status">The reasoning model is reading the whole case…</p>
      ) : p.status === "failed" ? (
        <p className="ws-small ws-error-text" role="status">Model call failed: {p.error}. No decision was proposed; the rule-based route stands.</p>
      ) : p.status === "rejected_by_validation" ? (
        <div className="ws-small ws-warn-text" role="status">
          The model&apos;s proposal was rejected by validation, so it is not used:
          <ul>{(p.problems ?? []).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : proposal && p.plan ? (
        <div className="ws-proposal" data-stale={!p.current || undefined}>
          <div className="ws-proposal-head">
            <strong className={`ws-proposal-decision ws-pd-${proposal.decision}`}>{DECISION_LABEL[proposal.decision]}</strong>
            <span className="ws-tag ws-tag-live" title={p.provider}>Proposed by model · {p.provider?.split(":")[0]}</span>
          </div>
          {!p.current && <p className="ws-small ws-warn-text">The case changed after this proposal. It is shown for reference and can&apos;t be acted on.</p>}
          <p className="ws-small">{proposal.summary}</p>
          <p className={`ws-plan ws-plan-${p.plan.kind}`}>
            <strong>{p.resolution ? (p.resolution.accepted ? (p.plan.kind === "needs_person_to_approve" ? "Approved by a person" : "Denial confirmed by a person") : "Rejected by a person") : PLAN_LABEL[p.plan.kind]}</strong>
            <span className="ws-small ws-muted"> — {p.resolution ? `${exactTime(p.resolution.at)}${p.resolution.note ? ` · “${p.resolution.note}”` : ""}` : p.plan.note}</span>
          </p>
          {!p.resolution && p.current && (p.plan.kind === "needs_person_to_approve" || p.plan.kind === "needs_person_to_confirm_denial") && (
            <ResolveControls proposalId={p._id} kind={p.plan.kind} />
          )}
          <details className="ws-details" open>
            <summary>Why ({proposal.rationale.length})</summary>
            <ul className="ws-trace-list ws-small">
              {proposal.rationale.map((r) => <li key={r.point}>{r.point} {r.refs.filter((x) => !x.startsWith("R:")).map((x) => <RefChip key={x} refId={x} />)}</li>)}
            </ul>
          </details>
          {proposal.legalBasis.length > 0 && (
            <details className="ws-details">
              <summary>Legal reading ({proposal.legalBasis.length})</summary>
              <ul className="ws-trace-list ws-small">
                {proposal.legalBasis.map((l) => (
                  <li key={l.sourceRef}><strong>{getSource(l.sourceRef)?.citation ?? l.sourceRef}</strong> · {READING_LABEL[l.reading]} — {l.note}</li>
                ))}
              </ul>
              <p className="ws-small ws-muted">The model&apos;s reading of the curated sources. Not legal advice.</p>
            </details>
          )}
          {proposal.missingInformation.length > 0 && (
            <p className="ws-small"><span className="ws-eyebrow">Missing</span> {proposal.missingInformation.join(" · ")}</p>
          )}
          {proposal.nextQuestion && <p className="ws-small"><span className="ws-eyebrow">Next question</span> “{proposal.nextQuestion}” <span className="ws-muted">(asked on the customer&apos;s next call when the rules have nothing to ask)</span></p>}
          {proposal.documents.length > 0 && (
            <details className="ws-details">
              <summary>Drafted documents ({proposal.documents.length})</summary>
              {proposal.documents.map((d) => (
                <div key={d.kind} className="ws-draft">
                  <p className="ws-small ws-muted">{d.kind.replace(/_/g, " ")} · drafted by the model, not an approved template, not sent</p>
                  <p className="ws-prewrap">{d.text}</p>
                </div>
              ))}
            </details>
          )}
          {(p.problems ?? []).length > 0 && <p className="ws-small ws-muted">Validator notes: {(p.problems ?? []).join("; ")}</p>}
        </div>
      ) : null}

      {analysis && (
        <p className="ws-small ws-muted ws-ruleroute">
          Rule-based route: <strong>{RECOMMENDATION_LABEL[analysis.recommendation.action]}</strong> — {analysis.recommendation.rationale} <a href="#trace">Decision trace</a>
        </p>
      )}
      {data?.enabled && (
        <p className="ws-action">
          <button type="button" className="ws-btn" disabled={busy || p?.status === "pending"} onClick={askNow}>{busy ? "Asking…" : p ? "Ask the model again" : "Ask the model now"}</button>
          <span className="ws-small ws-muted">live Bitdeer call (uses credits)</span>
          {error && <span className="ws-small ws-error-text" role="status">{error}</span>}
        </p>
      )}
    </section>
  );
}

function DecisionRecord({ d }: { d: Doc<"reimbursementDecisions"> }) {
  return (
    <div className="ws-decided">
      <strong>{d.outcome === "auto_approved" ? `Approved automatically under ${d.policy}` : "Approved by a person"}</strong> · {usd(d.amount)} for <RefChip refId={d.txnRef} />
      <div className="ws-small ws-muted">
        SIMULATED payout: {d.payout.status}
        {d.payout.status === "failed" && d.payout.error ? ` (${d.payout.error})` : ""} · {exactTime(d.decidedAt)}
      </div>
      {d.needsReview && <div className="ws-small ws-warn-text">Needs review: {d.needsReview.reason}</div>}
    </div>
  );
}

function ResolveControls({ proposalId, kind }: { proposalId: Id<"caseProposals">; kind: "needs_person_to_approve" | "needs_person_to_confirm_denial" }) {
  const resolve = useMutation(api.proposals.resolve);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await resolve({ proposalId, accept, note });
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ws-resolve">
      <label className="ws-field">
        <span className="ws-small">Note <span className="ws-muted">(required to reject; sent to nobody)</span></span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="ws-resolve-actions">
        <button type="button" className="ws-btn ws-btn-primary" disabled={busy} onClick={() => act(true)}>
          {kind === "needs_person_to_approve" ? "Approve (SIMULATED payout)" : "Confirm denial"}
        </button>
        <button type="button" className="ws-btn" disabled={busy} onClick={() => act(false)}>Reject proposal</button>
      </div>
      {error && <p className="ws-small ws-error-text" role="status">{error}</p>}
    </div>
  );
}
