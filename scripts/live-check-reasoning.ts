/**
 * Explicit LIVE check of the reasoning provider (Bitdeer). Not part of `npm test`.
 *
 *   npm run live:reasoning                # list models, then interpret two SYNTHETIC statements
 *   npm run live:reasoning -- --models    # only list the models your key can use
 *
 * Reads REASONING_BASE_URL, REASONING_API_KEY, REASONING_MODEL (and REASONING_PROVIDER_LABEL)
 * from .env.local. Sends only the synthetic statements below. Uses credits.
 */
import { config } from "dotenv";
import { OpenAICompatibleReasoningProvider } from "../lib/providers/reasoning";
import { redact } from "../lib/providers/errors";

config({ path: ".env.local" });

const SAMPLES = [
  {
    statement: "Someone claiming to be my bank called and asked for a code, and then $389 disappeared from my checking account on October 17.",
    questionAsked: null,
  },
  { statement: "Me.", questionAsked: "Did you personally enter and send this payment, or did someone else do that?" },
  // The scripted extractor read this as "authorized" on the live test of 2026-10-24.
  { statement: "An unknown transaction for 5 dollars appeared in my account. I do not believe I authorized it.", questionAsked: null },
];

async function main() {
  const baseUrl = process.env.REASONING_BASE_URL;
  const apiKey = process.env.REASONING_API_KEY;
  const model = process.env.REASONING_MODEL;
  if (!baseUrl || !apiKey) throw new Error("Set REASONING_BASE_URL and REASONING_API_KEY in .env.local");

  // GET /v1/models is documented by Bitdeer: https://developers.bitdeer.ai/docs/api
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`GET /models HTTP ${res.status}: ${redact(await res.text()).split(apiKey).join("[REDACTED]").slice(0, 200)}`);
  const ids = (((await res.json()) as { data?: { id?: string }[] }).data ?? []).map((m) => m.id).filter(Boolean);
  console.log(`Models available to this key (${ids.length}):\n  ${ids.join("\n  ")}`);
  if (process.argv.includes("--models")) return;

  if (!model) throw new Error("Set REASONING_MODEL in .env.local (pick one from the list above)");
  if (ids.length && !ids.includes(model)) console.log(`warning: ${model} is not in the list above`);
  const provider = new OpenAICompatibleReasoningProvider({ baseUrl, apiKey, model, providerLabel: process.env.REASONING_PROVIDER_LABEL || "bitdeer" });
  for (const [i, s] of SAMPLES.entries()) {
    const started = Date.now();
    const r = await provider.interpret({
      statement: { ref: `S${i + 1}`, text: s.statement, receivedAt: Date.UTC(2026, 9, 24, 18) },
      questionAsked: s.questionAsked,
      priorStatements: SAMPLES.slice(0, i).map((p, j) => ({ ref: `S${j + 1}`, text: p.statement })),
      citableRefs: SAMPLES.slice(0, i + 1).map((_, j) => `S${j + 1}`),
    });
    console.log(`\nSYNTHETIC S${i + 1}: "${s.statement}"${s.questionAsked ? ` (reply to: "${s.questionAsked}")` : ""}`);
    console.log(`  ${Date.now() - started} ms · ${r.provider}`);
    console.log(`  ${JSON.stringify(r.interpretation)}`);
    if (r.followUpQuestion) console.log(`  follow-up suggested: ${r.followUpQuestion}`);
  }
  console.log("\nVoice waits up to VOICE_INTERPRETATION_WAIT_MS (default 4500 ms) for this; compare with the times above.");
}

main().catch((e) => {
  console.error(redact(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
