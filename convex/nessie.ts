"use node";
/**
 * Live Nessie retrieval. The account ID comes from the case record (bound by the backend),
 * never from client or model input. Failures are recorded and displayed; fixtures are
 * never substituted.
 */
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { NessieClient, retrieveAccountTransactions } from "../lib/providers/nessie";
import { redact } from "../lib/providers/errors";

export const retrieveBankEvidence = action({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<{ ok: boolean; count?: number; error?: string }> => {
    const c = await ctx.runQuery(internal.cases.getForAction, { caseId });
    if (!c) throw new Error("case not found");
    const fail = async (error: string) => {
      await ctx.runMutation(internal.cases.recordBankFetchError, { caseId, error });
      return { ok: false, error };
    };
    const accountId = c.nessieAccountId ?? (await ctx.runMutation(internal.cases.bindConfiguredAccount, { caseId }));
    if (!accountId) return fail("no Nessie demo account bound to this case (set NESSIE_DEMO_ACCOUNT_ID in the Convex environment)");
    const apiKey = process.env.NESSIE_API_KEY;
    if (!apiKey) return fail("NESSIE_API_KEY is not set in the Convex deployment environment");
    try {
      const client = new NessieClient(apiKey, process.env.NESSIE_BASE_URL || undefined);
      const { transactions, warnings } = await retrieveAccountTransactions(client, accountId);
      await ctx.runMutation(internal.cases.storeTransactions, { caseId, transactions, warnings });
      return { ok: true, count: transactions.length };
    } catch (e) {
      return fail(redact(e instanceof Error ? e.message : String(e)));
    }
  },
});
