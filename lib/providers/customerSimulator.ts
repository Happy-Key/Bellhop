/**
 * SIMULATED CUSTOMER for the claim suite (test aid only, never part of a real conversation). The
 * reasoning model plays a SYNTHETIC demo persona and answers whatever the assistant actually asked,
 * using only what the persona knows (lib/fixtures/customerSim.ts customerBrief). Uses the same
 * OpenAI-compatible endpoint as the app's reasoning (Bitdeer); a failure is reported, never replaced
 * with a canned line.
 */
import { z } from "zod";
import { ProviderError, redact, type FetchLike } from "./errors";
import type { OpenAICompatibleConfig } from "./reasoning";

const SIMULATOR_PROMPT = `You are role-playing a bank customer in a TEST of a bank's fraud-claims assistant. Stay in character.
You get: who you are and everything you know (brief), the conversation so far, and the assistant's latest message.
Reply as the customer to the assistant's latest message only:
- Answer exactly what was asked, in one or two short spoken sentences. Use the brief's wording when it has an answer for this question.
- Use only facts in the brief. If the brief doesn't cover it, say you don't know or aren't sure. Never invent amounts, dates, names or events.
- Don't volunteer facts that weren't asked about, unless the brief's answer to this question includes them.
- If asked to confirm a payment, say yes only if it matches the payment you dispute; otherwise say which one you mean.
- Never read out a code, password, PIN or card number.
Return ONLY the reply text, no quotes or labels.`;

export interface SimulatorTurn {
  role: "customer" | "assistant";
  text: string;
}

export async function simulateCustomerReply(
  cfg: OpenAICompatibleConfig,
  input: { brief: string; conversation: SimulatorTurn[]; latest: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const id = `${cfg.providerLabel}:${cfg.model}:customer-simulator`;
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
        messages: [
          { role: "system", content: SIMULATOR_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
    });
  } catch (e) {
    throw new ProviderError(id, "network", redact(String(e)));
  }
  if (!res.ok) throw new ProviderError(id, "http", `HTTP ${res.status}`, res.status);
  const parsed = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ProviderError(id, "malformed_response", "missing choices[0].message.content");
  const text = parsed.data.choices[0]!.message.content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^["'“]|["'”]$/g, "")
    .replace(/^customer:\s*/i, "")
    .trim()
    .slice(0, 500);
  if (!text) throw new ProviderError(id, "malformed_response", "empty reply");
  return text;
}
