"use client";

/**
 * Case review workspace: case and payment navigation (left), the case narrative and evidence
 * (centre), and next steps (right). Everything shown comes from cases.view; the next steps are
 * the shared triage of the stored analysis (lib/domain/triage.ts).
 */
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { STAGE_LABEL, triageCase, type StoredAnalysis } from "@/lib/domain/triage";
import type { EvidenceFetchState } from "@/lib/domain/workflow";
import { HighlightProvider } from "./EvidenceRef";
import { EvidenceTrail } from "./EvidenceTrail";
import { BankRecords, DraftPacket, IdentityEvidence, ReportSummary, Statements, Timeline } from "./CaseSections";
import { NextSteps } from "./NextSteps";
import { caseRef, exactTime, usd } from "./format";
import type { CaseView, Payment } from "./types";

export function CaseReview({ caseId }: { caseId: string }) {
  const data = useQuery(api.cases.view, { caseId: caseId as Id<"cases"> });
  const [focusRef, setFocusRef] = useState<string | null>(null);

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

  const analysis = data.case.analysis as StoredAnalysis | null;
  const bankFetch = data.case.bankFetch as EvidenceFetchState;
  const triage = triageCase({ analysis, bankFetch, statementCount: data.statements.length });
  const payments = paymentsOf(data, analysis);
  const focused = payments.find((p) => p.ref === focusRef) ?? payments[0] ?? null;
  const firstStatement = data.statements[0];

  return (
    <HighlightProvider>
      <main className="ws-main ws-case">
        <header className="ws-casehead">
          <div>
            <Link href={`/review?case=${data.case._id}`} className="ws-back">← Claims queue</Link>
            <h1>
              {caseRef(data.case._id)} <span className="ws-stage">{STAGE_LABEL[analysis?.stage ?? "intake"]}</span>
            </h1>
            <p className="ws-casemeta">
              <span>
                Report received{" "}
                <strong>{firstStatement ? exactTime(firstStatement.receivedAt) : "— no statement yet"}</strong>
              </span>
              <span>Case opened {exactTime(data.case.createdAt)}</span>
              <span>{data.case.customerLabel}</span>
            </p>
          </div>
        </header>

        <div className="ws-case-grid">
          <nav className="ws-rail" aria-label="Case sections and payments">
            <h2 className="ws-eyebrow">Sections</h2>
            <ul className="ws-toc">
              <li><a href="#summary">Customer report</a></li>
              <li><a href="#trail">Evidence trail</a></li>
              <li><a href="#statements">Statements <span className="ws-count">{data.statements.length}</span></a></li>
              <li><a href="#records">Bank records <span className="ws-count">{data.transactions.length}</span></a></li>
              <li><a href="#identity">Identity evidence <span className="ws-count">{data.providerEvidence.length}</span></a></li>
              <li><a href="#packet">Draft packet</a></li>
              <li><a href="#timeline">Timeline</a></li>
            </ul>

            <h2 className="ws-eyebrow" id="payments-label">Payment under review</h2>
            {payments.length === 0 ? (
              <p className="ws-muted ws-small">{noPaymentReason(analysis, bankFetch)}</p>
            ) : (
              <div className="ws-payments" role="group" aria-labelledby="payments-label">
                {payments.map((p) => (
                  <button key={p.ref} type="button" className="ws-payment" aria-pressed={focused?.ref === p.ref} onClick={() => setFocusRef(p.ref)}>
                    <span className="ws-payment-amt">{usd(p.amount)}</span>
                    <span className="ws-payment-merchant">{p.merchant ?? "Unknown merchant"}</span>
                    <span className="ws-payment-meta">
                      {p.date ?? "date unknown"} · {p.matched ? "matched" : "candidate"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="ws-muted ws-small">
              Candidates come from the rule-based matcher. This prototype tracks one disputed payment per case.
            </p>
          </nav>

          <div className="ws-center">
            <ReportSummary data={data} analysis={analysis} />
            <EvidenceTrail analysis={analysis} payment={focused} paymentCount={payments.length} />
            <Statements data={data} analysis={analysis} />
            <BankRecords data={data} analysis={analysis} focusedRef={focused?.ref ?? null} />
            <IdentityEvidence data={data} />
            <DraftPacket analysis={analysis} />
            <Timeline data={data} />
          </div>

          <NextSteps caseId={data.case._id} triage={triage} analysis={analysis} />
        </div>
      </main>
    </HighlightProvider>
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
      <div className="ws-case-grid">
        <div className="ws-rail"><div className="ws-skel ws-skel-block" /></div>
        <div className="ws-center"><div className="ws-skel ws-skel-block" /><div className="ws-skel ws-skel-block" /></div>
        <div className="ws-next"><div className="ws-skel ws-skel-block" /></div>
      </div>
    </main>
  );
}
