/**
 * Shared helpers for the Nessie seed scripts. They WRITE to the shared Nessie sandbox (data is
 * visible to other API users), so every script that uses them requires --confirm.
 */
import { config } from "dotenv";
import { NESSIE_DEFAULT_BASE_URL } from "../lib/providers/nessie";

config({ path: ".env.local" });

export const key = process.env.NESSIE_API_KEY;
export const base = (process.env.NESSIE_BASE_URL || NESSIE_DEFAULT_BASE_URL).replace(/\/$/, "");

export function idFrom(json: unknown): string {
  const j = json as { objectCreated?: { _id?: unknown }; _id?: unknown } | null;
  const id = j?.objectCreated?._id ?? j?._id;
  if (typeof id !== "string") throw new Error(`could not find created _id in response: ${JSON.stringify(json).slice(0, 200)}`);
  return id;
}

export async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}?key=${encodeURIComponent(key!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Refuses to write without NESSIE_API_KEY and an explicit --confirm. */
export function requireConfirm(command: string) {
  if (!key) throw new Error("NESSIE_API_KEY missing from .env.local");
  if (!process.argv.includes("--confirm")) {
    console.log(`This writes SYNTHETIC records to the shared Nessie sandbox. Re-run with: ${command} -- --confirm`);
    process.exit(1);
  }
}

/** Prints an error with the API key masked, then exits. */
export function exitWithError(e: unknown): never {
  console.error(String(e instanceof Error ? e.message : e).split(key ?? "\u0000").join("[REDACTED]"));
  process.exit(1);
}
