"use client";

/**
 * The result, first: what the model proposes (or what prevents a proposal), what a person or policy
 * has authorized, and what has been executed. Three distinct states; the reviewer's controls live
 * here and only here.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, Hourglass, XCircle } from "lucide-react";
import { DECISION_LABEL, PLAN_LABEL, checkLabel, policyLabel } from "@/lib/review/labels";
import { exactTime, shortTime, usd } from "./format";
import { RefChips } from "./EvidenceRef";
import { ReviewControls } from "./ReviewActions";
import { Mark, Pill } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export function DecisionBand() {
  const { ws, select, isSelected } = useWorkspace();
  const { status, proposal, data, reassessing, problem } = ws;
  const d = status.disposition;
  const o = status.outcome;
  const flag = status.flag;
  const decision = data.decisions[0] ?? null;
  const accepted = ws.history.find((h) => h.status === "done");
  const acceptedAt = accepted?.completedAt ?? null;
  const why = (proposal?.rationale ?? []).slice(0, 3);
  const link = (sel: Parameters<typeof select>[0], text: string) => (
    <button type="button" className={`dec-link${isSelected(sel) ? " is-selected" : ""}`} aria-pressed={isSelected(sel)} onClick={() => select(sel)}>
      {text}
    </button>
  );

  return (
    <section className="card dec" aria-label="Decision">
      <div className="dec-cols">
        <div className="dec-col">
          <span className="dec-label">
            <Mark kind="model" labelled={false} /> Proposed
          </span>
          {d ? (
            <>
              <div className="dec-title">
                <h3>{DECISION_LABEL[d.decision]}</h3>
                {d.amount !== null && <span className="dec-amt">{usd(d.amount)}</span>}
              </div>
              {d.summary && <p className="dec-sum">{d.summary}</p>}
              <p className="dec-meta">
                {d.plan ? (PLAN_LABEL[d.plan.kind] ?? d.plan.kind) : ""}
                {acceptedAt ? ` · ${shortTime(acceptedAt)}` : ""}
              </p>
              {!d.current && (
                <Pill tone="warn">
                  <Hourglass size={12} aria-hidden="true" /> Case changed since{reassessing ? " · reassessing" : ""}
                </Pill>
              )}
              {d.overridden && status.lastAction && (
                <p className="dec-meta">
                  <Mark kind="person" labelled={false} /> {status.lastAction.decision ? DECISION_LABEL[status.lastAction.decision] : "Decided differently"} · “{status.lastAction.reason}”
                </p>
              )}
              {link({ kind: "disposition" }, "Rationale and uncertainty")}
            </>
          ) : status.nextQuestion ? (
            <>
              <h3 className="dec-none">Ask the customer</h3>
              <p className="dec-sum">“{status.nextQuestion}”</p>
              <p className="dec-meta">{status.nextQuestionBy === "reviewer" ? "Reviewer's question" : "Model's question"} · next call</p>
              {link({ kind: "question" }, "Why this question")}
            </>
          ) : (
            <>
              <h3 className="dec-none">
                <CircleDashed size={18} aria-hidden="true" /> {reassessing ? "Reassessing" : "No disposition yet"}
              </h3>
              {problem && <p className="dec-meta error">{problem}</p>}
              {!reassessing && status.blockers.length > 0 && (
                <ul className="blockers">
                  {status.blockers.map((b) => (
                    <li key={b}>
                      <Mark kind="blocking" labelled={false} className="mark-crit" /> {b}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="dec-col">
          <span className="dec-label">
            <Mark kind={o?.by === "policy" ? "policy" : "person"} labelled={false} /> Authorized
          </span>
          {o ? (
            <>
              <div className="dec-title">
                <h3>{o.kind === "approved" ? "Approved" : "Denied"}</h3>
                {o.amount !== null && <span className="dec-amt">{usd(o.amount)}</span>}
              </div>
              <p className="dec-meta">
                {o.by === "policy" ? policyLabel(decision?.policy ?? "AUTO-1").name : "A person"} · {exactTime(o.at)}
              </p>
              {link({ kind: "outcome" }, "Decision record")}
            </>
          ) : (
            <>
              <h3 className="dec-none">
                <CircleDashed size={18} aria-hidden="true" /> Not yet
              </h3>
              <p className="dec-meta">{d?.awaitingPerson ? (d.decision === "approve" ? "Needs a person's approval" : "Needs a person's confirmation") : d?.decision === "escalate" ? "A specialist decides" : ""}</p>
            </>
          )}
          {decision && (
            <p className="dec-exec">
              {decision.payout.status === "deposited" ? <CheckCircle2 size={14} aria-hidden="true" /> : decision.payout.status === "failed" ? <XCircle size={14} aria-hidden="true" /> : <Hourglass size={14} aria-hidden="true" />}
              <span>
                Payout {decision.payout.status} · simulated{decision.payout.at ? ` · ${shortTime(decision.payout.at)}` : ""}
                {decision.payout.status === "failed" && decision.payout.error ? ` · ${decision.payout.error}` : ""}
              </span>
            </p>
          )}
          {flag && (
            <div className="dec-flag" role="status">
              <span className="dec-flag-head">
                <AlertTriangle size={14} aria-hidden="true" /> Flagged after approval · {shortTime(flag.at)}
              </span>
              {flag.failedChecks.length > 0 ? (
                <ul>
                  {flag.failedChecks.map((id) => (
                    <li key={id}>{checkLabel(id)}: no longer passes</li>
                  ))}
                </ul>
              ) : (
                <span>{flag.reason}</span>
              )}
              {flag.review && (
                <span>
                  <Mark kind="person" labelled={false} /> Kept flagged {shortTime(flag.review.at)} · “{flag.review.note}”
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {why.length > 0 && (
        <ol className="dec-why">
          {why.map((r, i) => (
            <li key={i}>
              {r.point} <RefChips refs={r.refs} withSources />
            </li>
          ))}
        </ol>
      )}

      <ReviewControls />
    </section>
  );
}
