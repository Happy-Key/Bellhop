/**
 * Read-only queries for the bank-side claims workstation (/review). They project what is already
 * stored; nothing here changes a case. Triage logic lives in lib/domain/triage.ts.
 */
import { query } from "./_generated/server";
import { readStoredAnalysis, triageCase } from "../lib/domain/triage";
import type { EvidenceFetchState } from "../lib/domain/workflow";
import type { CaseProposal } from "../lib/domain/caseDecision";
import { caseStatus } from "../lib/review/caseStatus";
import { caseReasoningEnabled } from "./proposals";
import { openReviewerQuestions } from "./reviewerQuestions";

/** Most recent cases shown in the queue. */
export const QUEUE_LIMIT = 100;

export const queue = query({
  args: {},
  handler: async (ctx) => {
    const cases = await ctx.db.query("cases").order("desc").take(QUEUE_LIMIT);
    return Promise.all(
      cases.map(async (c) => {
        const [statements, lastActivity] = await Promise.all([
          ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
          ctx.db.query("activity").withIndex("by_case", (q) => q.eq("caseId", c._id)).order("desc").first(),
        ]);
        const analysis = readStoredAnalysis(c.analysis);
        const bankFetch = c.bankFetch as EvidenceFetchState;
        const matchedRef = analysis?.match.matchedRef ?? null;
        const matched = matchedRef
          ? (await ctx.db.query("transactions").withIndex("by_case_ref", (q) => q.eq("caseId", c._id).eq("ref", matchedRef)).collect()).find((t) => t.supersededAt === undefined) ?? null
          : null;
        const facts = analysis?.facts;
        const proposals = await ctx.db.query("caseProposals").withIndex("by_case", (q) => q.eq("caseId", c._id)).order("desc").take(20);
        const newest = proposals[0] ?? null;
        const accepted = proposals.find((p) => p.status === "done") ?? null;
        const decisions = await ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect();
        const status = caseStatus({
          analysis,
          bankFetch,
          statementCount: statements.length,
          // "current" here means no newer case state has been sent to the model since.
          assessment: accepted?.proposal
            ? {
                proposal: accepted.proposal as CaseProposal,
                plan: accepted.plan ?? null,
                provider: accepted.provider ?? null,
                completedAt: accepted.completedAt ?? accepted.requestedAt,
                current: !proposals.some((p) => p.requestedAt > accepted.requestedAt && p.signature !== accepted.signature),
                resolution: accepted.resolution ?? null,
              }
            : null,
          reassessing: newest?.status === "pending",
          modelProblem: newest && (newest.status === "failed" || newest.status === "rejected_by_validation") ? (newest.error ?? (newest.problems ?? []).join("; ")) : null,
          modelEnabled: caseReasoningEnabled(),
          outcomes: decisions.map((d) => ({ outcome: d.outcome, amount: d.amount, txnRef: d.txnRef, policy: d.policy, decidedAt: d.decidedAt, payoutStatus: d.payout.status, needsReview: d.needsReview ?? null })),
          matchedAmount: matched?.amount ?? null,
          reviewerQuestions: (await openReviewerQuestions(ctx, c._id)).map((q) => q.text),
        });
        const firstStatement = statements.reduce<(typeof statements)[number] | null>((a, s) => (!a || s.receivedAt < a.receivedAt ? s : a), null);
        return {
          _id: c._id,
          createdAt: c.createdAt,
          /** When the customer's first statement arrived (the report time), or null if none yet. */
          reportedAt: firstStatement?.receivedAt ?? null,
          channels: [...new Set(statements.map((s) => s.channel))],
          statementCount: statements.length,
          stage: analysis?.stage ?? "intake",
          recommendation: analysis ? { action: analysis.recommendation.action, rationale: analysis.recommendation.rationale } : null,
          matchOutcome: analysis?.match.outcome ?? null,
          candidateCount: analysis?.match.candidates.length ?? 0,
          matched: matched ? { ref: matched.ref, amount: matched.amount, date: matched.date, merchant: matched.merchantName ?? matched.description } : null,
          /** Customer-reported values (unverified), latest first per field. */
          reported: {
            amount: facts?.amounts.at(-1)?.value ?? null,
            date: facts?.dates.at(-1)?.value ?? null,
            merchant: facts?.merchantTerms.at(-1)?.value ?? null,
          },
          conflictCount: facts?.conflicts.length ?? 0,
          bankFetchStatus: bankFetch.status,
          lastActivity: lastActivity ? { at: lastActivity.at, message: lastActivity.message } : null,
          triage: triageCase({ analysis, bankFetch, statementCount: statements.length }),
          /** The investigation-first view: who acts, the active work, any proposal or outcome. */
          status: {
            attention: status.attention,
            headline: status.headline,
            statusLabel: status.statusLabel,
            source: status.source,
            sourceLabel: status.sourceLabel,
            summary: status.summary,
            work: status.work.map((w) => ({ key: w.key, title: w.title, doneTitle: w.doneTitle, status: w.status })),
            disposition: status.disposition ? { decision: status.disposition.decision, amount: status.disposition.amount, awaitingPerson: status.disposition.awaitingPerson } : null,
            outcome: status.outcome ? { label: status.outcome.label, needsReview: status.outcome.needsReview } : null,
            blockers: status.blockers,
            findingCount: status.investigation.findings.length,
            uncertaintyCount: status.investigation.uncertainties.length,
          },
        };
      }),
    );
  },
});
