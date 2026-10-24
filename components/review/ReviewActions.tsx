"use client";

/**
 * The reviewer's controls, only the ones that apply to the current case state: approve, confirm or
 * reject a proposal that needs a person; decide differently with a reason (never money); return the
 * case to the investigator; review a flagged approval; retry a failed simulated payout; retrieve
 * missing records. In demo mode, decide-differently and return go to local state.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DECISION_LABEL } from "@/lib/review/labels";
import type { OverrideDecision } from "@/lib/review/caseStatus";
import { usd } from "./format";
import { RetrieveButton } from "./RetrieveButton";
import { ActionDialog, errorText } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type Dialog = "approve" | "confirm_denial" | "reject" | "override" | "return" | "affirm" | "keep_flag" | null;

export function ReviewControls() {
  const { ws, onDemoAction } = useWorkspace();
  const { status, mode, accepted, data, reassessing } = ws;
  const d = status.disposition;
  const flag = status.flag;
  const decision = data.decisions[0] ?? null;
  const [dialog, setDialog] = useState<Dialog>(null);
  const demo = mode === "demo";
  const demoLocal = demo && !!onDemoAction;

  const canResolve = !demo && !!d?.awaitingPerson && !!accepted?.id;
  const canOverride = (!demo || demoLocal) && !!accepted?.id && accepted.current && !status.outcome && !d?.overridden && !reassessing && (!!d || !!status.nextQuestion);
  const canReturn = (!demo || demoLocal) && !status.outcome && !reassessing && !status.returned && data.statements.length > 0;
  const canReviewFlag = !demo && !!flag && !!flag.decisionId;
  const canRetryPayout = !demo && decision?.payout.status === "failed";
  const needsRecords = !demo && data.statements.length > 0 && data.case.bankFetch.status !== "ok";

  if (!canResolve && !canOverride && !canReturn && !canReviewFlag && !canRetryPayout && !needsRecords) return null;

  return (
    <div className="dec-controls" aria-label="Reviewer controls">
      {needsRecords && <RetrieveButton caseId={data.case._id} again={data.case.bankFetch.status === "error"} primary />}
      {canReviewFlag && (
        <>
          <button type="button" className="btn btn-primary" onClick={() => setDialog("affirm")}>
            Affirm the approval
          </button>
          <button type="button" className="btn" onClick={() => setDialog("keep_flag")}>
            Keep flagged
          </button>
        </>
      )}
      {canResolve && (
        <>
          <button type="button" className="btn btn-primary" disabled={reassessing} onClick={() => setDialog(d!.decision === "approve" ? "approve" : "confirm_denial")}>
            {d!.decision === "approve" ? `Approve${d!.amount !== null ? ` ${usd(d!.amount)}` : ""}` : "Confirm denial"}
          </button>
          <button type="button" className="btn" disabled={reassessing} onClick={() => setDialog("reject")}>
            Reject
          </button>
        </>
      )}
      {canOverride && (
        <button type="button" className="btn" onClick={() => setDialog("override")}>
          Decide differently
        </button>
      )}
      {canReturn && (
        <button type="button" className="btn" onClick={() => setDialog("return")}>
          Return to investigator
        </button>
      )}
      {canRetryPayout && <RetryPayout decisionId={decision!._id} />}

      {accepted?.id && (dialog === "approve" || dialog === "confirm_denial" || dialog === "reject") && (
        <ResolveDialog kind={dialog} proposalId={accepted.id} amount={d?.amount ?? null} onClose={() => setDialog(null)} />
      )}
      {dialog === "override" && <OverrideDialog proposalId={accepted?.id ?? null} proposed={d?.decision ?? "request_information"} onClose={() => setDialog(null)} />}
      {dialog === "return" && <ReturnDialog caseId={data.case._id} proposalId={accepted?.id ?? null} onClose={() => setDialog(null)} />}
      {flag?.decisionId && (dialog === "affirm" || dialog === "keep_flag") && <FlagDialog affirm={dialog === "affirm"} decisionId={flag.decisionId as Id<"reimbursementDecisions">} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useAction<T>(run: (arg: T) => Promise<unknown> | void, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (arg: T) => {
    setBusy(true);
    setError(null);
    try {
      await run(arg);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}

function ResolveDialog({ kind, proposalId, amount, onClose }: { kind: "approve" | "confirm_denial" | "reject"; proposalId: Id<"caseProposals">; amount: number | null; onClose: () => void }) {
  const resolve = useMutation(api.proposals.resolve);
  const [note, setNote] = useState("");
  const { busy, error, act } = useAction(() => resolve({ proposalId, accept: kind !== "reject", note }), onClose);
  const titles = { approve: `Approve${amount !== null ? ` ${usd(amount)}` : ""}`, confirm_denial: "Confirm the denial", reject: "Reject the proposal" };
  return (
    <ActionDialog open title={titles[kind]} intro={kind === "approve" ? `Schedules a simulated payout${amount !== null ? ` of ${usd(amount)}` : ""}.` : undefined} confirm={titles[kind]} onConfirm={() => act(undefined)} onClose={onClose} busy={busy} error={error} destructive={kind === "reject"}>
      <label className="field">
        <span>{kind === "reject" ? "Reason" : "Note"}</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </label>
    </ActionDialog>
  );
}

function OverrideDialog({ proposalId, proposed, onClose }: { proposalId: Id<"caseProposals"> | null; proposed: string; onClose: () => void }) {
  const override = useMutation(api.proposals.override);
  const { onDemoAction } = useWorkspace();
  const options = (["request_information", "escalate", "deny"] as OverrideDecision[]).filter((x) => x !== proposed);
  const [decision, setDecision] = useState<OverrideDecision>(options[0]!);
  const [reason, setReason] = useState("");
  const [question, setQuestion] = useState("");
  const { busy, error, act } = useAction(() => {
    if (!reason.trim()) throw new Error("A reason is required");
    if (decision === "request_information" && !question.trim()) throw new Error("Write the question");
    if (onDemoAction) return onDemoAction({ kind: "override", decision, reason: reason.trim(), ...(decision === "request_information" ? { question: question.trim() } : {}) });
    if (!proposalId) throw new Error("No proposal to decide on");
    return override({ proposalId, decision, reason, ...(decision === "request_information" ? { question } : {}) });
  }, onClose);
  return (
    <ActionDialog open title="Decide differently" confirm="Record" onConfirm={() => act(undefined)} onClose={onClose} busy={busy} error={error}>
      <label className="field">
        <span>Decision</span>
        <select value={decision} onChange={(e) => setDecision(e.target.value as OverrideDecision)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {DECISION_LABEL[o]}
            </option>
          ))}
        </select>
      </label>
      {decision === "request_information" && (
        <label className="field">
          <span>Question for the customer</span>
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Reason</span>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
    </ActionDialog>
  );
}

function ReturnDialog({ caseId, proposalId, onClose }: { caseId: Id<"cases">; proposalId: Id<"caseProposals"> | null; onClose: () => void }) {
  const ret = useMutation(api.proposals.returnToAgent);
  const { onDemoAction } = useWorkspace();
  const [text, setText] = useState("");
  const { busy, error, act } = useAction(() => {
    if (!text.trim()) throw new Error("Say what to look into");
    if (onDemoAction) return onDemoAction({ kind: "return", request: text.trim() });
    return ret({ caseId, ...(proposalId ? { proposalId } : {}), request: text });
  }, onClose);
  return (
    <ActionDialog open title="Return to the investigator" confirm="Send back" onConfirm={() => act(undefined)} onClose={onClose} busy={busy} error={error}>
      <label className="field">
        <span>What to look into</span>
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
    </ActionDialog>
  );
}

function FlagDialog({ affirm, decisionId, onClose }: { affirm: boolean; decisionId: Id<"reimbursementDecisions">; onClose: () => void }) {
  const review = useMutation(api.payoutData.reviewFlaggedApproval);
  const [note, setNote] = useState("");
  const { busy, error, act } = useAction(() => review({ decisionId, affirm, note }), onClose);
  return (
    <ActionDialog open title={affirm ? "Affirm the approval" : "Keep flagged"} intro={affirm ? "The simulated payout stands." : undefined} confirm={affirm ? "Affirm" : "Keep flagged"} onConfirm={() => act(undefined)} onClose={onClose} busy={busy} error={error}>
      <label className="field">
        <span>Note</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </label>
    </ActionDialog>
  );
}

function RetryPayout({ decisionId }: { decisionId: Id<"reimbursementDecisions"> }) {
  const retry = useMutation(api.payoutData.retryPayout);
  const { busy, error, act } = useAction(() => retry({ decisionId }), () => {});
  return (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => act(undefined)}>
        {busy ? "Retrying…" : "Retry payout"}
      </button>
      {error && (
        <span className="small error" role="status">
          {error}
        </span>
      )}
    </>
  );
}
