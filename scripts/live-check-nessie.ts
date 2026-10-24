/**
 * Explicit LIVE check of the Nessie integration (read-only). Not part of `npm test`.
 *
 *   npm run live:nessie
 *
 * Reads NESSIE_API_KEY and NESSIE_DEMO_ACCOUNT_ID from .env.local.
 */
import { config } from "dotenv";
import { NessieClient, retrieveAccountTransactions } from "../lib/providers/nessie";

config({ path: ".env.local" });

async function main() {
  const key = process.env.NESSIE_API_KEY;
  const account = process.env.NESSIE_DEMO_ACCOUNT_ID;
  if (!key || !account) throw new Error("Set NESSIE_API_KEY and NESSIE_DEMO_ACCOUNT_ID in .env.local");
  const { transactions, warnings } = await retrieveAccountTransactions(new NessieClient(key, process.env.NESSIE_BASE_URL || undefined), account);
  console.log(`LIVE Nessie: ${transactions.length} purchase(s) for the demo account.`);
  for (const t of transactions.slice(0, 20)) console.log(`  ${t.ref} ${t.date} $${t.amount} ${t.merchantName ?? "?"} status=${t.status}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
