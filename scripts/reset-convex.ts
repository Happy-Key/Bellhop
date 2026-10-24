/**
 * Starts the demo completely anew on the Convex deployment named in .env.local (CONVEX_DEPLOYMENT):
 *
 * 1. Deletes every Convex row (cases, statements, assessments, decisions, suite runs…). Keeps the
 *    CRS login lock (providerAuth).
 * 2. Restores each demo persona's Nessie account (NESSIE_PERSONA_ACCOUNTS) and the plain demo
 *    account (NESSIE_DEMO_ACCOUNT_ID) to exactly what was seeded, by deleting the SIMULATED payout
 *    deposits this app made (only deposits whose description is our payout format). Then reads each
 *    persona account back and checks it against its seed (lib/fixtures/demoPersonas.ts).
 *
 *   npm run reset:convex -- --confirm                # both
 *   npm run reset:convex -- --confirm --keep-nessie  # Convex only
 *
 * Deleting our payouts is the one Nessie delete this project makes (user-approved 2026-10-24) and
 * it is never done by the app itself, only by this explicit command.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import { NESSIE_DEFAULT_BASE_URL, NessieClient, retrieveAccountTransactions } from "../lib/providers/nessie";
import { isAppPayout } from "../lib/domain/fraudSignals";
import { DEMO_PERSONAS, seedDifferences } from "../lib/fixtures/demoPersonas";

config({ path: ".env.local" });
const deployment = process.env.CONVEX_DEPLOYMENT ?? "(unknown)";
const nessieKey = process.env.NESSIE_API_KEY;
const nessieBase = (process.env.NESSIE_BASE_URL || NESSIE_DEFAULT_BASE_URL).replace(/\/$/, "");
const keepNessie = process.argv.includes("--keep-nessie");
const win = process.platform === "win32";

function convex(args: string[], capture: boolean) {
  // npx is npx.cmd on Windows, which needs a shell, and the shell needs JSON arguments quoted.
  const quoted = win ? args.map((a) => (a.startsWith("{") ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  return spawnSync("npx", ["convex", ...quoted], { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8", shell: win });
}

/** A Convex env value (not printed). */
function convexEnv(name: string): string | null {
  const r = convex(["env", "get", name], true);
  const v = (r.stdout ?? "").trim();
  return r.status === 0 && v && !v.startsWith("✖") ? v : null;
}

/** Retries a Nessie step on a network blip (the sandbox drops connections now and then). */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`  (retrying ${what} after: ${String(e instanceof Error ? e.message : e).split(nessieKey ?? "\u0000").join("[REDACTED]").slice(0, 120)})`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function restoreNessie() {
  if (!nessieKey) throw new Error("NESSIE_API_KEY missing from .env.local (needed to restore the persona accounts; or pass --keep-nessie)");
  const client = new NessieClient(nessieKey, nessieBase);
  const raw = convexEnv("NESSIE_PERSONA_ACCOUNTS");
  const personaAccounts = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  const demoAccount = convexEnv("NESSIE_DEMO_ACCOUNT_ID");
  const accounts = [...Object.entries(personaAccounts), ...(demoAccount ? [["demo account", demoAccount] as const] : [])];
  let problems = 0;
  for (const [label, accountId] of accounts) {
    const ours = (await withRetry(`${label} deposits`, () => client.listDeposits(accountId))).filter((d) => isAppPayout(d.description));
    for (const d of ours) {
      await withRetry(`deleting ${d._id}`, async () => {
        const res = await fetch(`${nessieBase}/deposits/${d._id}?key=${encodeURIComponent(nessieKey)}`, { method: "DELETE" });
        // 404: already gone (a retried delete that went through).
        if (!res.ok && res.status !== 404) throw new Error(`deleting SIMULATED payout ${d._id} on ${label} -> HTTP ${res.status}`);
      });
    }
    const persona = DEMO_PERSONAS.find((p) => p.id === label);
    const diffs = persona
      ? await withRetry(`${label} read-back`, async () => {
          const { transactions, warnings } = await retrieveAccountTransactions(client, accountId);
          // A merchant lookup that failed leaves names blank; that's a read failure, not a difference.
          if (warnings.length) throw new Error(warnings.join("; "));
          return seedDifferences(persona, transactions);
        })
      : [];
    problems += diffs.length;
    console.log(`  ${label}: removed ${ours.length} SIMULATED payout(s)${persona ? (diffs.length ? `; DIFFERS from seed: ${diffs.join("; ")}` : "; matches its seed") : ""}`);
  }
  const missing = DEMO_PERSONAS.filter((p) => !personaAccounts[p.id]).map((p) => p.id);
  if (missing.length) console.log(`  No Nessie account configured for: ${missing.join(", ")} (run npm run seed:personas).`);
  if (problems) throw new Error("some persona accounts differ from their seed; re-seed them with npm run seed:personas -- --confirm --only=<ids>");
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log(`This deletes EVERY case, statement, assessment, decision and suite run on Convex deployment ${deployment},`);
    console.log(keepNessie ? "and leaves Nessie alone." : "and deletes this app's SIMULATED payout deposits from the persona and demo Nessie accounts.");
    console.log("Re-run with: npm run reset:convex -- --confirm");
    process.exit(1);
  }
  console.log(`Resetting Convex deployment ${deployment}…`);
  const total: Record<string, number> = {};
  for (let done = false; !done; ) {
    const r = convex(["run", "admin:resetAll", JSON.stringify({ confirm: "delete every row" })], true);
    if (r.status !== 0) throw new Error("admin:resetAll failed");
    const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as { deleted: Record<string, number>; done: boolean };
    for (const [t, n] of Object.entries(out.deleted)) total[t] = (total[t] ?? 0) + n;
    done = out.done;
  }
  console.log(`  Deleted: ${Object.entries(total).map(([t, n]) => `${t} ${n}`).join(", ") || "nothing (already empty)"}.`);
  if (keepNessie) return;
  console.log("Restoring the Nessie demo accounts to their seeds…");
  await restoreNessie();
  console.log("Done: a fresh start.");
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e).split(nessieKey ?? "\u0000").join("[REDACTED]"));
  process.exit(1);
});
