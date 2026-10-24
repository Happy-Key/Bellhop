/**
 * Seeds a SYNTHETIC demo customer/account/merchants/purchases in the Nessie sandbox.
 *
 *   npm run seed:nessie -- --confirm
 *
 * Reads NESSIE_API_KEY from .env.local. Writes to the SHARED Nessie sandbox (data is
 * visible to other API users), so it refuses to run without --confirm.
 * Purchase POST body follows the documented purchase fields; it is not in the official
 * OpenAPI spec, so the script re-reads the account afterwards to verify what was stored.
 */
import { DEMO_ACCOUNT, DEMO_CUSTOMER, DEMO_MERCHANTS, DEMO_PURCHASES } from "../lib/fixtures/demo";
import { NessieClient, retrieveAccountTransactions } from "../lib/providers/nessie";
import { base, daysAgo, exitWithError, idFrom, key, post, requireConfirm } from "./nessie-seed-helpers";

async function main() {
  requireConfirm("npm run seed:nessie");
  const customerId = idFrom(await post("/customers", DEMO_CUSTOMER));
  console.log(`customer created: ${customerId}`);
  const accountId = idFrom(await post(`/customers/${customerId}/accounts`, DEMO_ACCOUNT));
  console.log(`account created: ${accountId}`);

  const merchantIds = new Map<string, string>();
  for (const m of DEMO_MERCHANTS) {
    const id = idFrom(await post("/merchants", { name: m.name, category: m.category }));
    merchantIds.set(m.key, id);
    console.log(`merchant created: ${m.name} -> ${id}`);
  }
  for (const p of DEMO_PURCHASES) {
    const res = await post(`/accounts/${accountId}/purchases`, {
      merchant_id: merchantIds.get(p.merchant),
      medium: "balance",
      purchase_date: daysAgo(p.daysAgo),
      amount: p.amount,
      status: "completed",
      description: p.description,
    });
    console.log(`purchase posted: $${p.amount} ${p.merchant} -> ${JSON.stringify(res).slice(0, 120)}`);
  }

  const { transactions, warnings } = await retrieveAccountTransactions(new NessieClient(key!, base), accountId);
  console.log(`\nVerification read-back: ${transactions.length} purchase(s) stored.`);
  for (const t of transactions) console.log(`  ${t.ref} ${t.date} $${t.amount} ${t.merchantName ?? "?"} status=${t.status}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  console.log(`\nNext: npx convex env set NESSIE_DEMO_ACCOUNT_ID ${accountId}`);
  console.log(`and add NESSIE_DEMO_ACCOUNT_ID=${accountId} to .env.local for npm run live:nessie`);
}

main().catch(exitWithError);
