/**
 * Deployment reset (DEMO / DEV AID): deletes every row this app stores, for a fresh start before a
 * demo. Internal only, so it can't be called from a browser; run it from the CLI with
 * `npm run reset:convex -- --confirm` (scripts/reset-convex.ts), which targets the deployment in
 * .env.local.
 *
 * Kept: `providerAuth` (the CRS login lock must survive a reset, or a locked sandbox account could
 * be retried into being disabled). Not touched: anything outside Convex, such as the Nessie sandbox
 * (persona accounts, earlier SIMULATED payout deposits) and Cartesia.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { TableNames } from "./_generated/dataModel";

/** Every table except providerAuth. tests/convex.test.ts checks this covers the schema. */
export const RESET_TABLES = [
  "cases",
  "statements",
  "transactions",
  "providerEvidence",
  "activity",
  "processedEvents",
  "paymentOrigins",
  "reimbursementDecisions",
  "caseProposals",
  "intakeTurns",
  "reviewerQuestions",
  "suiteRuns",
  "voiceSessions",
] as const satisfies readonly TableNames[];

export const KEPT_TABLES = ["providerAuth"] as const satisfies readonly TableNames[];

/** Rows deleted per table per transaction; the mutation reschedules itself until every table is empty. */
const BATCH = 400;

export const resetAll = internalMutation({
  args: { confirm: v.literal("delete every row"), round: v.optional(v.number()) },
  handler: async (ctx, { confirm, round = 1 }) => {
    const deleted: Record<string, number> = {};
    let more = false;
    for (const table of RESET_TABLES) {
      const rows = await ctx.db.query(table).take(BATCH);
      for (const r of rows) await ctx.db.delete(r._id);
      if (rows.length) deleted[table] = rows.length;
      if (rows.length === BATCH) more = true;
    }
    if (more) await ctx.scheduler.runAfter(0, internal.admin.resetAll, { confirm, round: round + 1 });
    console.log(`reset round ${round}: ${JSON.stringify(deleted)}${more ? " (continuing)" : " (done)"}`);
    return { round, deleted, done: !more };
  },
});
