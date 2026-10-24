/**
 * Seeds the SYNTHETIC demo personas (lib/fixtures/demoPersonas.ts) in the Nessie sandbox: one
 * customer, account, set of merchants and purchases each.
 *
 *   npm run seed:personas -- --confirm                  # all personas
 *   npm run seed:personas -- --confirm --only=margaret  # re-seed some (comma-separated)
 *
 * Writes to the SHARED Nessie sandbox (visible to other API users), so it requires --confirm. Each
 * account is read back and checked against the fixture. Prints the NESSIE_PERSONA_ACCOUNTS value
 * to set in the Convex environment; with --only, merge it into the existing value.
 */
import { DEMO_PERSONAS, personaPurchaseFor, type DemoPersona } from "../lib/fixtures/demoPersonas";
import { NessieClient, retrieveAccountTransactions } from "../lib/providers/nessie";
import { base, daysAgo, exitWithError, idFrom, key, post, requireConfirm } from "./nessie-seed-helpers";

async function seed(p: DemoPersona): Promise<string> {
  const [first, ...rest] = p.name.split(" ");
  const customerId = idFrom(
    await post("/customers", {
      first_name: first,
      last_name: `${rest.join(" ")} (synthetic)`,
      address: { street_number: p.home.streetNumber, street_name: p.home.streetName, city: p.home.city, state: p.home.state, zip: p.home.zip },
    }),
  );
  const accountId = idFrom(await post(`/customers/${customerId}/accounts`, { type: "Checking", nickname: `FCI demo persona ${p.id} (synthetic)`, rewards: 0, balance: 2500 }));
  console.log(`${p.id}: customer ${customerId}, account ${accountId}`);

  const merchantIds = new Map<string, string>();
  for (const m of p.merchants) merchantIds.set(m.name, idFrom(await post("/merchants", { name: m.name, category: m.category })));
  for (const x of p.purchases) {
    await post(`/accounts/${accountId}/purchases`, {
      merchant_id: merchantIds.get(x.merchant),
      medium: "balance",
      purchase_date: daysAgo(x.daysAgo),
      amount: x.amount,
      status: "completed",
      description: x.description,
    });
  }

  // Read back: every fixture purchase must come back with its merchant name and amount, since that
  // is how the backend attaches the persona's payment-origin records.
  const { transactions, warnings } = await retrieveAccountTransactions(new NessieClient(key!, base), accountId);
  for (const t of transactions) console.log(`  ${t.ref} ${t.date} $${t.amount} ${t.merchantName ?? "?"} status=${t.status}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  const missing = p.purchases.filter((x) => !transactions.some((t) => personaPurchaseFor(p, t)?.key === x.key));
  if (missing.length) throw new Error(`${p.id}: read-back is missing ${missing.map((x) => x.key).join(", ")}`);
  return accountId;
}

async function main() {
  requireConfirm("npm run seed:personas");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",");
  const personas = only ? DEMO_PERSONAS.filter((p) => only.includes(p.id)) : DEMO_PERSONAS;
  if (personas.length === 0) throw new Error(`no personas match --only=${only?.join(",")}`);
  const accounts: Record<string, string> = {};
  for (const p of personas) accounts[p.id] = await seed(p);
  console.log(`\nVerified ${personas.length} persona account(s). Set this in the Convex environment:`);
  console.log(`  NESSIE_PERSONA_ACCOUNTS=${JSON.stringify(accounts)}`);
}

main().catch(exitWithError);
