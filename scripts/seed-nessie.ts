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
import { config } from "dotenv";
import { DEMO_ACCOUNT, DEMO_CUSTOMER, DEMO_MERCHANTS, DEMO_PURCHASES } from "../lib/fixtures/demo";
import { NessieClient, retrieveAccountTransactions, NESSIE_DEFAULT_BASE_URL } from "../lib/providers/nessie";

config({ path: ".env.local" });

const key = process.env.NESSIE_API_KEY;
const base = (process.env.NESSIE_BASE_URL || NESSIE_DEFAULT_BASE_URL).replace(/\/$/, "");

function idFrom(json: unknown): string {
  const j = json as { objectCreated?: { _id?: unknown }; _id?: unknown } | null;
  const id = j?.objectCreated?._id ?? j?._id;
  if (typeof id !== "string") throw new Error(`could not find created _id in response: ${JSON.stringify(json).slice(0, 200)}`);
  return id;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}?key=${encodeURIComponent(key!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  if (!key) throw new Error("NESSIE_API_KEY missing from .env.local");
  if (!process.argv.includes("--confirm")) {
    console.log("This writes SYNTHETIC records to the shared Nessie sandbox. Re-run with: npm run seed:nessie -- --confirm");
    process.exit(1);
  }
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

  const { transactions, warnings } = await retrieveAccountTransactions(new NessieClient(key, base), accountId);
  console.log(`\nVerification read-back: ${transactions.length} purchase(s) stored.`);
  for (const t of transactions) console.log(`  ${t.ref} ${t.date} $${t.amount} ${t.merchantName ?? "?"} status=${t.status}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  console.log(`\nNext: npx convex env set NESSIE_DEMO_ACCOUNT_ID ${accountId}`);
  console.log(`and add NESSIE_DEMO_ACCOUNT_ID=${accountId} to .env.local for npm run live:nessie`);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).split(key ?? "\u0000").join("[REDACTED]"));
  process.exit(1);
});
