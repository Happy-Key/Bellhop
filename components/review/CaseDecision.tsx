"use client";

/**
 * Disposition panel (right column of a case): the authorized outcome if there is one, the
 * reasoning model's proposed disposition with the computed amount and who must authorize it, the
 * next step, and the model's status. Approvals within policy AUTO-1, requests for information and
 * escalations happen without a person; denials and other approvals wait for one.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import { RECOMMENDATION_LABEL, type StoredAnalysis } from "@/lib/domain/triage";
import { DECISION_LABEL, type CaseStatus } from "@/lib/review/caseStatus";
import { RefChip } from "./EvidenceRef";
import { RetrieveButton } from "./RetrieveButton";
import { exactTime, usd } from "./format";

const PLAN_LABEL: Record<string, string> = {
  automatic: "Applied automatically",
  auto_approved: "Approved automatically (AUTO-1)",
  needs_person_to_approve: "Needs a person to approve",
  needs_person_to_confirm_denial: "Needs a person to confirm",
};

export interface DispositionPanelProps {
  caseId: Id<"cases">;
  status: CaseStatus;
  analysis: StoredAnalysis | null;
  decisions: Doc<"reimbursementDecisions">[];
  /** The newest accepted assessment row (for the proposal id and rationale). */
  accepted: { _id: Id<"caseProposals">; proposal: unknown } | null;
  matchedRef: string | null;
  bankOk: boolean;
  bankNever: boolean;
  modelEnabled: boolean;
  reassessing: boolean;
  /** Questions reviewers put to the customer, newest first. */
  asked: Doc<"reviewerQuestions">[];
}

export function DispositionPanel({ caseId, status, analysis, decisions, accepted, matchedRef, bankOk, bankNever, modelEnabled, reassessing, asked }: DispositionPanelProps) {
  const ask = useMutation(api.proposals.requestProposal);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = status.disposition;
  const proposal = (accepted?.proposal ?? null) as CaseProposal | null;

  const askNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await ask({ caseId });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ws-next ws-disposition" aria-labelledby="disp-h">
      <h2 id="disp-h">Outcome</h2>

      {decisions.map((x) => <DecisionRecord key={x._id} d={x} />)}
      {status.outcome && status.outcome.by === "person" && decisions.length === 0 && (
        <div className="ws-decided"><strong>{status.outcome.label}</strong><div className="ws-small ws-muted">{exactTime(status.outcome.at)}</div></div>
      )}

      {d ? (
        <div className="ws-proposal" data-stale={!d.current || undefined}>
          <span className="ws-eyebrow">Proposed disposition · reasoning model</span>
          <strong className={`ws-proposal-decision ws-pd-${d.decision}`}>{DECISION_LABEL[d.decision]}</strong>
          {d.amount !== null && (
            <p className="ws-amount">{usd(d.amount)} <span className="ws-small ws-muted">computed from the matched record {matchedRef && <RefChip refId={matchedRef} />}, not by the model</span></p>
          )}
          {!d.current && <p className="ws-small ws-warn-text">The case changed after this proposal. It is shown for reference and can&apos;t be acted on until the model reassesses.</p>}
          {d.plan && (
            <p className={`ws-plan ws-plan-${d.plan.kind}`}>
              <strong>{d.resolution ? (d.resolution.accepted ? "Authorized by a person" : "Rejected by a person") : PLAN_LABEL[d.plan.kind] ?? d.plan.kind}</strong>
              <span className="ws-small ws-muted"> — {d.resolution ? `${exactTime(d.resolution.at)}${d.resolution.note ? ` · “${d.resolution.note}”` : ""}` : d.plan.note}</span>
            </p>
          )}
          {d.awaitingPerson && accepted && d.plan && <ResolveControls proposalId={accepted._id} kind={d.plan.kind as "needs_person_to_approve" | "needs_person_to_confirm_denial"} />}
          {proposal && (
            <details className="ws-details">
              <summary>Why ({proposal.rationale.length})</summary>
              <ul className="ws-trace-list ws-small">
                {proposal.rationale.map((r, i) => <li key={i}>{r.point} {[...new Set(r.refs)].filter((x) => !x.startsWith("R:")).map((x) => <RefChip key={x} refId={x} />)}</li>)}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="ws-small ws-muted">{status.source === "model" ? "No disposition proposed yet: the investigation is still open." : "No model proposal. Dispositions are proposed by the reasoning model; the rule-based route is a guardrail only."}</p>
      )}

      <div className="ws-nextaction">
        <span className="ws-eyebrow">Next</span>
        <p><strong>{status.headline}</strong></p>
        {status.nextQuestion && <p className="ws-small ws-muted">Chosen by the reasoning model. The voice assistant asks it on the customer&apos;s next call; this prototype sends no outbound messages.</p>}
        {!bankOk && <RetrieveButton caseId={caseId} again={!bankNever} primary />}
      </div>

      <AskCustomer caseId={caseId} asked={asked} />

      <div className="ws-modelstate">
        {modelEnabled ? (
          <p className="ws-action">
            <button type="button" className="ws-btn" disabled={busy || reassessing} onClick={askNow}>{reassessing ? "Reassessing…" : busy ? "Asking…" : "Reassess now"}</button>
            <span className="ws-small ws-muted">live Bitdeer call (uses credits)</span>
            {error && <span className="ws-small ws-error-text" role="status">{error}</span>}
          </p>
        ) : (
          <p className="ws-small ws-muted">Live reasoning is off on this deployment, so the rule-based fallback is shown.</p>
        )}
        {analysis && (
          <p className="ws-small ws-muted">
            Guardrail (rules): {RECOMMENDATION_LABEL[analysis.recommendation.action]}. <a href="#rec-rules">Details</a>
          </p>
        )}
      </div>
    </aside>
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

/** A reviewer's question for the customer: asked first on their next call or text chat. */
function AskCustomer({ caseId, asked }: { caseId: Id<"cases">; asked: Doc<"reviewerQuestions">[] }) {
  const ask = useMutation(api.reviewerQuestions.ask);
  const withdraw = useMutation(api.reviewerQuestions.withdraw);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /s, "").split("\n")[0]! : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ws-ask">
      <span className="ws-eyebrow">Ask the customer</span>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void run(async () => { await ask({ caseId, text }); setText(""); });
        }}
      >
        <label className="ws-field">
          <span className="ws-visually-hidden">Question for the customer</span>
          <textarea rows={2} value={text} maxLength={300} placeholder="e.g. Do you still have the card?" onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="ws-btn ws-btn-sm" disabled={busy || !text.trim()}>Ask on the next call or chat</button>
      </form>
      {error && <p className="ws-small ws-error-text" role="status">{error}</p>}
      {asked.length > 0 && (
        <ul className="ws-asked">
          {asked.map((q) => (
            <li key={q._id} className="ws-small">
              “{q.text}”{" "}
              {q.answeredByRef ? (
                <span className="ws-muted">answered in <RefChip refId={q.answeredByRef} /></span>
              ) : q.withdrawnAt ? (
                <span className="ws-muted">withdrawn</span>
              ) : (
                <>
                  <span className="ws-warn-text">waiting</span>{" "}
                  <button type="button" className="ws-link" disabled={busy} onClick={() => void run(() => withdraw({ questionId: q._id }))}>Withdraw</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
