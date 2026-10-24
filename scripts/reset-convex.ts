/**
 * Clears every row from the Convex deployment named in .env.local (CONVEX_DEPLOYMENT), for a fresh
 * demo start. Keeps the CRS login lock (providerAuth). Doesn't touch Nessie or Cartesia.
 *
 *   npm run reset:convex -- --confirm
 *
 * Big tables are cleared over several scheduled rounds; they finish within seconds of this returning.
 */
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local" });
const deployment = process.env.CONVEX_DEPLOYMENT ?? "(unknown)";

if (!process.argv.includes("--confirm")) {
  console.log(`This deletes EVERY case, statement, assessment, decision and suite run on Convex deployment ${deployment}.`);
  console.log("Re-run with: npm run reset:convex -- --confirm");
  process.exit(1);
}

console.log(`Resetting Convex deployment ${deployment}…`);
const args = JSON.stringify({ confirm: "delete every row" });
// npx is npx.cmd on Windows, which needs a shell, and the shell needs the JSON quoted.
const win = process.platform === "win32";
const r = spawnSync("npx", ["convex", "run", "admin:resetAll", win ? `"${args.replace(/"/g, '\\"')}"` : args], { stdio: "inherit", shell: win });
process.exit(r.status ?? 1);
