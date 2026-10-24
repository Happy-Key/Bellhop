/**
 * Read-only queries for the bank-side claims workstation (/review). They project what is already
 * stored; nothing here changes a case. Triage logic lives in lib/domain/triage.ts.
 */
import { query } from "./_generated/server";
import { triageCase, type StoredAnalysis } from "../lib/domain/triage";
import type { EvidenceFetchState } from "../lib/domain/workflow";

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
        const analysis = c.analysis as StoredAnalysis | null;
        const bankFetch = c.bankFetch as EvidenceFetchState;
        const matchedRef = analysis?.match.matchedRef ?? null;
        const matched = matchedRef
          ? (await ctx.db.query("transactions").withIndex("by_case_ref", (q) => q.eq("caseId", c._id).eq("ref", matchedRef)).collect()).find((t) => t.supersededAt === undefined) ?? null
          : null;
        const facts = analysis?.facts;
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
        };
      }),
    );
  },
});
