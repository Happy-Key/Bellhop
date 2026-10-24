"use client";

/**
 * Case workspace, conclusion first: what happened, the investigation under way, what is
 * established and still open, and (right) the proposed disposition and who must act. The decision
 * record underneath holds the evidence, rules, assessment history, documents and activity, collapsed
 * until needed. The investigation comes from the reasoning model's latest accepted assessment, or
 * from the labelled rule-based fallback (lib/review/caseStatus.ts).
 */
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import { readStoredAnalysis, triageCase, type StoredAnalysis } from "@/lib/domain/triage";
import type { EvidenceFetchState } from "@/lib/domain/workflow";
import { caseStatus } from "@/lib/review/caseStatus";
import { intakeProgress } from "@/lib/review/intake";
import { RECONCILIATION_LABEL, reconciliation } from "@/lib/review/workspace";
import { HighlightProvider } from "./EvidenceRef";
import { EvidenceTrail } from "./EvidenceTrail";
import { BankRecords, IdentityEvidence, Statements } from "./CaseSections";
import { GuidedIntake } from "./GuidedIntake";
import { DecisionTrace, FindingsPanel, PreparedOutputs } from "./Investigation";
import { AssessmentHistory, CaseOverview, DecisionRecord, FindingsAndGaps, InvestigationBoard, ModelDocuments, RulesConsidered } from "./CaseInvestigation";
import { DispositionPanel } from "./CaseDecision";
import { Timeline } from "./Timeline";
import { WorkspaceModeProvider } from "./WorkspaceMode";
import { caseRef, exactTime, usd } from "./format";
import type { CaseView, Payment } from "./types";

export function CaseReview({ caseId }: { caseId: string }) {
  const data = useQuery(api.cases.view, { caseId: caseId as Id<"cases"> });
  const model = useQuery(api.proposals.latest, { caseId: caseId as Id<"cases"> });
  const asked = useQuery(api.reviewerQuestions.forCase, { caseId: caseId as Id<"cases"> });

  if (data === undefined) return <CaseSkeleton />;
  if (data === null)
    return (
      <main className="ws-main">
        <div className="ws-empty" role="alert">
          <p><strong>Case not found.</strong></p>
          <p className="ws-muted">It may have been created on a different Convex deployment.</p>
          <Link href="/review">← Back to the claims queue</Link>
        </div>
      </main>
    );
  return <CaseWorkspace data={data} model={model ?? null} asked={asked ?? []} />;
}

type ModelState = NonNullable<ReturnType<typeof useQuery<typeof api.proposals.latest>>>;

type AskedRow = NonNullable<ReturnType<typeof useQuery<typeof api.reviewerQuestions.forCase>>>[number];

export function CaseWorkspace({ data, model, asked }: { data: CaseView; model: ModelState | null; asked: AskedRow[] }) {
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const analysis = readStoredAnalysis(data.case.analysis);
  const bankFetch = data.case.bankFetch as EvidenceFetchState;
  const triage = triageCase({ analysis, bankFetch, statementCount: data.statements.length });
  const payments = paymentsOf(data, analysis);
  const focused = payments.find((p) => p.ref === focusRef) ?? payments[0] ?? null;
  const progress = intakeProgress(data.statements, analysis);

  const accepted = model?.accepted ?? null;
  const newest = model?.proposal ?? null;
  const reassessing = newest?.status === "pending";
  const problem = newest && (newest.status === "failed" || newest.status === "rejected_by_validation") ? (newest.error ?? (newest.problems ?? []).join("; ")) : null;
  const proposal = (accepted?.proposal ?? null) as CaseProposal | null;
  const matched = analysis?.match.matchedRef ? data.transactions.find((t) => t.ref === analysis.match.matchedRef) ?? null : null;
  const status = caseStatus({
    analysis,
    bankFetch,
    statementCount: data.statements.length,
    assessment: accepted && proposal ? { proposal, plan: accepted.plan ?? null, provider: accepted.provider ?? null, completedAt: accepted.completedAt ?? accepted.requestedAt, current: accepted.current, resolution: accepted.resolution ?? null } : null,
    reassessing,
    modelProblem: problem,
    modelEnabled: model?.enabled ?? false,
    outcomes: data.decisions.map((d) => ({ outcome: d.outcome, amount: d.amount, txnRef: d.txnRef, policy: d.policy, decidedAt: d.decidedAt, payoutStatus: d.payout.status, needsReview: d.needsReview ?? null })),
    matchedAmount: matched?.amount ?? null,
    reviewerQuestions: asked.filter((q) => !q.answeredByRef && !q.withdrawnAt).sort((a, b) => a.askedAt - b.askedAt).map((q) => q.text),
  });
  const auto = data.case.autoApproval as { policy: string; eligible: boolean; checks: { id: string; passed: boolean; detail: string }[] } | null | undefined;

  return (
    <WorkspaceModeProvider value="live">
      <HighlightProvider>
        <main className="ws-main ws-case">
          <header className="ws-casehead">
            <div>
              <Link href={`/review?case=${data.case._id}`} className="ws-back">← Claims queue</Link>
              <h1>
                {caseRef(data.case._id)} <span className="ws-stage">{status.statusLabel}</span>
              </h1>
              <p className="ws-casemeta">
                <span>{data.case.customerLabel}</span>
                <span>Case opened {exactTime(data.case.createdAt)}</span>
              </p>
            </div>
          </header>

          <div className="ws-case-grid ws-case-grid-2">
            <div className="ws-center">
              <CaseOverview data={data} status={status} payment={focused} noPayment={noPaymentReason(analysis, bankFetch)} />
              {payments.length > 1 && (
                <div className="ws-payments ws-payments-row" role="group" aria-label="Candidate payments">
                  {payments.map((p) => (
                    <button key={p.ref} type="button" className="ws-payment" aria-pressed={focused?.ref === p.ref} onClick={() => setFocusRef(p.ref)}>
                      <span className="ws-payment-amt">{usd(p.amount)}</span>
                      <span className="ws-payment-merchant">{p.merchant ?? "Unknown merchant"}</span>
                      <span className="ws-payment-meta">{p.date ?? "date unknown"} · {RECONCILIATION_LABEL[reconciliation(analysis, p.ref).state].toLowerCase()}</span>
                    </button>
                  ))}
                </div>
              )}
              <InvestigationBoard status={status} reassessing={reassessing} problem={problem} />
              <FindingsAndGaps status={status} />
              <DecisionRecord
                parts={[
                  {
                    id: "evidence",
                    title: "Evidence considered",
                    count: data.transactions.length + data.statements.length + data.providerEvidence.length,
                    body: (
                      <>
                        <EvidenceTrail analysis={analysis} payment={focused} paymentCount={payments.length} />
                        <Statements data={data} analysis={analysis} />
                        <BankRecords data={data} analysis={analysis} focusedRef={focused?.ref ?? null} />
                        <IdentityEvidence data={data} />
                      </>
                    ),
                  },
                  {
                    id: "rules",
                    title: "Rules, policies and conditions",
                    body: (
                      <>
                        <h3 className="ws-h3">The model&apos;s reading of the curated sources</h3>
                        <RulesConsidered proposal={proposal} />
                        {auto && (
                          <>
                            <h3 className="ws-h3">Policy {auto.policy}: automatic approval checks</h3>
                            <ul className="ws-trace-list ws-small">
                              {auto.checks.map((c) => <li key={c.id}>{c.passed ? "✓" : "✕"} <code>{c.id}</code> — {c.detail}</li>)}
                            </ul>
                          </>
                        )}
                        <DecisionTrace data={data} analysis={analysis} triage={triage} />
                        <FindingsPanel data={data} analysis={analysis} />
                      </>
                    ),
                  },
                  { id: "history", title: "How the assessment changed", count: model?.history.length ?? 0, body: <AssessmentHistory history={model?.history ?? []} reasons={proposal?.investigation.changes ?? []} /> },
                  { id: "conversation", title: "Conversation with the customer", count: progress.turns.length, body: <GuidedIntake progress={progress} /> },
                  {
                    id: "documents",
                    title: "Prepared documents and actions",
                    count: proposal?.documents.length ?? 0,
                    body: (
                      <>
                        <ModelDocuments proposal={proposal} />
                        <PreparedOutputs analysis={analysis} />
                      </>
                    ),
                  },
                  { id: "activity", title: "Activity log", count: data.activity.length, body: <Timeline data={data} recordSource="Nessie (live)" /> },
                ]}
              />
            </div>

            <DispositionPanel
              caseId={data.case._id}
              status={status}
              analysis={analysis}
              decisions={data.decisions}
              accepted={accepted ? { _id: accepted._id, proposal: accepted.proposal } : null}
              matchedRef={matched?.ref ?? null}
              bankOk={bankFetch.status === "ok"}
              bankNever={bankFetch.status === "never"}
              modelEnabled={model?.enabled ?? false}
              reassessing={reassessing}
              asked={asked}
            />
          </div>
        </main>
      </HighlightProvider>
    </WorkspaceModeProvider>
  );
}

/** The matched record, else the matcher's candidates, in the matcher's order. */
function paymentsOf(data: CaseView, analysis: StoredAnalysis | null): Payment[] {
  if (!analysis) return [];
  const byRef = new Map(data.transactions.map((t) => [t.ref, t]));
  const refs = analysis.match.matchedRef ? [analysis.match.matchedRef] : analysis.match.candidates.map((c) => c.txnRef);
  return refs.flatMap((ref) => {
    const t = byRef.get(ref);
    if (!t) return [];
    return [{ ref, amount: t.amount, date: t.date, merchant: t.merchantName ?? t.description, status: t.status, matched: ref === analysis.match.matchedRef, candidate: analysis.match.candidates.find((c) => c.txnRef === ref) ?? null }];
  });
}

function noPaymentReason(analysis: StoredAnalysis | null, bankFetch: EvidenceFetchState): string {
  if (bankFetch.status === "never") return "Bank records haven't been retrieved, so no payment is matched yet.";
  if (bankFetch.status === "error") return "Bank record retrieval failed, so no payment is matched.";
  switch (analysis?.match.outcome) {
    case "insufficient_facts":
      return "The customer hasn't given enough detail (amount, date or payee) to match a payment.";
    case "no_match":
      return "No bank record fits the reported details.";
    case "no_transactions":
      return "The account returned no records.";
    default:
      return "No candidate payment yet.";
  }
}

function CaseSkeleton() {
  return (
    <main className="ws-main ws-case" aria-busy="true">
      <header className="ws-casehead"><div><span className="ws-back">← Claims queue</span><h1 className="ws-muted">Loading case…</h1></div></header>
      <div className="ws-case-grid ws-case-grid-2">
        <div className="ws-center"><div className="ws-skel ws-skel-block" /><div className="ws-skel ws-skel-block" /></div>
        <div className="ws-next"><div className="ws-skel ws-skel-block" /></div>
      </div>
    </main>
  );
}
