"use client";

/**
 * Live case workspace entry: subscribes to the case view and the model's assessments, builds the
 * shared workspace state (lib/review/caseStatus.ts) and renders the workspace. Demo mode builds the
 * same state from the scripted fixture (components/review/PitchDemo.tsx).
 */
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AutoApprovalEvaluation } from "@/lib/domain/autoApproval";
import { readStoredProposal } from "@/lib/domain/caseDecision";
import { readStoredAnalysis } from "@/lib/domain/triage";
import type { EvidenceFetchState } from "@/lib/domain/workflow";
import { caseStatus } from "@/lib/review/caseStatus";
import type { CaseView } from "@/lib/review/types";
import { CaseWorkspace } from "./CaseWorkspace";
import type { Workspace, WorkspaceMode } from "./WorkspaceContext";

export type ModelState = FunctionReturnType<typeof api.proposals.latest>;

export function CaseReview({ caseId }: { caseId: string }) {
  const data = useQuery(api.cases.view, { caseId: caseId as Id<"cases"> });
  const model = useQuery(api.proposals.latest, { caseId: caseId as Id<"cases"> });
  if (data === undefined) return <CaseSkeleton />;
  if (data === null)
    return (
      <main className="page">
        <div className="empty" role="alert">
          <p>
            <strong>Case not found.</strong>
          </p>
          <p className="muted">It may have been deleted, or created on a different Convex deployment.</p>
          <p>
            <Link href="/review">Back to the claims queue</Link>
          </p>
        </div>
      </main>
    );
  return <LiveWorkspace data={data} model={model ?? null} />;
}

function LiveWorkspace({ data, model }: { data: CaseView; model: ModelState | null }) {
  const ws = useMemo(() => buildWorkspace({ data, model, mode: "live" }), [data, model]);
  return <CaseWorkspace ws={ws} />;
}

/** One place turns stored rows into what every panel reads. */
export function buildWorkspace({ data, model, mode }: { data: CaseView; model: ModelState | null; mode: WorkspaceMode }): Workspace {
  const analysis = readStoredAnalysis(data.case.analysis);
  const bankFetch = data.case.bankFetch as EvidenceFetchState;
  const acceptedRow = model?.accepted ?? null;
  const stored = acceptedRow ? readStoredProposal(acceptedRow.proposal) : null;
  const newest = model?.proposal ?? null;
  const reassessing = newest?.status === "pending";
  const problem = newest && (newest.status === "failed" || newest.status === "rejected_by_validation") ? (newest.error ?? (newest.problems ?? []).join("; ")) : null;
  const matched = analysis?.match.matchedRef ? (data.transactions.find((t) => t.ref === analysis.match.matchedRef) ?? null) : null;
  const status = caseStatus({
    analysis,
    bankFetch,
    statementCount: data.statements.length,
    assessment:
      acceptedRow && stored
        ? {
            id: acceptedRow._id,
            proposal: stored.proposal,
            legacy: stored.legacy,
            plan: acceptedRow.plan ?? null,
            provider: acceptedRow.provider ?? null,
            completedAt: acceptedRow.completedAt ?? acceptedRow.requestedAt,
            current: acceptedRow.current,
            resolution: acceptedRow.resolution ?? null,
          }
        : null,
    reassessing,
    modelProblem: problem,
    modelEnabled: model?.enabled ?? false,
    outcomes: data.decisions.map((d) => ({ id: d._id, outcome: d.outcome, amount: d.amount, txnRef: d.txnRef, policy: d.policy, decidedAt: d.decidedAt, payoutStatus: d.payout.status, needsReview: d.needsReview ?? null })),
    matchedAmount: matched?.amount ?? null,
    reviewActions: data.reviewActions.map((a) => ({ id: a._id, kind: a.kind, decision: a.decision, reason: a.reason, question: a.question, at: a.at })),
  });
  return {
    mode,
    data,
    analysis,
    status,
    proposal: stored?.proposal ?? null,
    legacy: stored?.legacy ?? false,
    auto: (data.case.autoApproval ?? null) as AutoApprovalEvaluation | null,
    accepted: acceptedRow ? { id: acceptedRow._id, current: acceptedRow.current } : null,
    history: model?.history ?? [],
    reassessing,
    problem,
    modelEnabled: model?.enabled ?? false,
  };
}

function CaseSkeleton() {
  return (
    <div className="cw" aria-busy="true">
      <header className="cw-head">
        <div className="cw-head-main">
          <span className="muted small">Claims queue</span>
          <h1 className="muted">Loading case…</h1>
        </div>
      </header>
      <div className="cw-grid">
        <main className="cw-main">
          <div className="skel" style={{ height: 180 }} />
          <div className="skel" style={{ height: 140, marginTop: 16 }} />
        </main>
        <aside className="cw-side">
          <div className="skel" style={{ height: 240 }} />
        </aside>
      </div>
    </div>
  );
}
