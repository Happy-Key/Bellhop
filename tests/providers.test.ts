import { describe, expect, it } from "vitest";
import { NessieClient, retrieveAccountTransactions } from "@/lib/providers/nessie";
import { OpenAICompatibleReasoningProvider } from "@/lib/providers/reasoning";
import { ProviderError, redact, type FetchLike } from "@/lib/providers/errors";
import { voiceIdempotencyKey, voiceUtteranceKey } from "@/lib/domain/idempotency";

const ACCOUNT = "acc-0000-1111-2222";
const MERCHANT = "mer-0000-1111-2222-3333-4444";

function mockFetch(routes: Record<string, () => Response | Promise<Response>>, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const path = new URL(url).pathname;
    const h = routes[path];
    if (!h) return new Response(JSON.stringify({ message: "Missing Authentication Token" }), { status: 403 });
    return h();
  };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("Nessie client (mocked)", () => {
  it("normalizes purchases using purchase_date and merchant names", async () => {
    const calls: string[] = [];
    const client = new NessieClient("test-key", undefined, mockFetch({
      [`/accounts/${ACCOUNT}`]: () => ok({ _id: ACCOUNT, type: "Checking" }),
      [`/accounts/${ACCOUNT}/purchases`]: () => ok([{ _id: "p-1", merchant_id: MERCHANT, medium: "balance", purchase_date: "2026-10-19", amount: 49, status: "executed", description: "Gift card", extra: "ignored" }]),
      [`/merchants/${MERCHANT}`]: () => ok({ _id: MERCHANT, name: "FCI Demo GiftCard Hub" }),
    }, calls));
    const { transactions, warnings } = await retrieveAccountTransactions(client, ACCOUNT);
    expect(warnings).toEqual([]);
    expect(transactions).toEqual([{
      ref: "T:p-1", provider: "nessie", externalId: "p-1", kind: "purchase", amount: 49, date: "2026-10-19",
      description: "Gift card", merchantId: MERCHANT, merchantName: "FCI Demo GiftCard Hub", status: "executed", medium: "balance",
    }]);
    expect(calls.every((c) => c.includes("key=test-key"))).toBe(true);
  });

  it("reports merchant lookup failures as warnings, not silent gaps", async () => {
    const client = new NessieClient("k", undefined, mockFetch({
      [`/accounts/${ACCOUNT}`]: () => ok({ _id: ACCOUNT }),
      [`/accounts/${ACCOUNT}/purchases`]: () => ok([{ _id: "p-1", merchant_id: MERCHANT, amount: 5 }]),
    }));
    const r = await retrieveAccountTransactions(client, ACCOUNT);
    expect(r.transactions[0]?.merchantName).toBeNull();
    expect(r.warnings[0]).toMatch(/merchant .* lookup failed/);
  });

  it("raises a typed error on HTTP failure without leaking the key", async () => {
    const client = new NessieClient("super-secret", undefined, mockFetch({ [`/accounts/${ACCOUNT}`]: () => new Response("boom key=super-secret", { status: 500 }) }));
    const err = await client.getAccount(ACCOUNT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("http");
    expect((err as Error).message).not.toContain("super-secret");
  });

  it("rejects malformed provider responses", async () => {
    const client = new NessieClient("k", undefined, mockFetch({ [`/accounts/${ACCOUNT}/purchases`]: () => ok([{ _id: "p-1", amount: "lots" }]) }));
    await expect(client.listPurchases(ACCOUNT)).rejects.toMatchObject({ kind: "malformed_response" });
    const client2 = new NessieClient("k", undefined, mockFetch({ [`/accounts/${ACCOUNT}/purchases`]: () => new Response("<html>", { status: 200 }) }));
    await expect(client2.listPurchases(ACCOUNT)).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("maps network failures to a typed error", async () => {
    const client = new NessieClient("k", undefined, async () => { throw new TypeError("fetch failed"); });
    await expect(client.getAccount(ACCOUNT)).rejects.toMatchObject({ kind: "network" });
  });

  it("refuses identifiers that could alter the request path", async () => {
    const client = new NessieClient("k", undefined, mockFetch({}));
    await expect(client.listPurchases("../customers")).rejects.toMatchObject({ kind: "rejected_output" });
  });

  it("requires a key", () => {
    expect(() => new NessieClient("")).toThrow(ProviderError);
  });
});

describe("OpenAI-compatible reasoning provider (mocked)", () => {
  const ctx = { statement: { ref: "S1", text: "I did not make the $389 purchase", receivedAt: Date.UTC(2026, 9, 23) }, priorStatements: [], citableRefs: ["S1"] };
  const provider = (content: string, status = 200) =>
    new OpenAICompatibleReasoningProvider({ baseUrl: "https://example.invalid/v1", apiKey: "k", model: "m", providerLabel: "test" }, async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));

  it("parses valid JSON (including fenced) and labels it live", async () => {
    const out = { amounts: [389], dates: [], merchantTerms: [], authorization: "denies_authorization", credentialSharing: "unspecified", scamIndicators: [], findings: [], followUpQuestion: "When did you notice?" };
    const r = await provider("```json\n" + JSON.stringify(out) + "\n```").interpret(ctx);
    expect(r.mode).toBe("live");
    expect(r.interpretation.mode).toBe("live");
    expect(r.interpretation.amounts).toEqual([389]);
  });

  it("throws on malformed model output instead of falling back", async () => {
    await expect(provider("Sure! The customer is clearly a fraudster.").interpret(ctx)).rejects.toMatchObject({ kind: "malformed_response" });
    await expect(provider(JSON.stringify({ amounts: [-5] })).interpret(ctx)).rejects.toMatchObject({ kind: "malformed_response" });
  });

  it("throws on HTTP errors", async () => {
    await expect(provider("{}", 429).interpret(ctx)).rejects.toMatchObject({ kind: "http", httpStatus: 429 });
  });

  it("sends the question being answered so short replies can be read, with bearer auth", async () => {
    let sent: { url: string; auth: string | null; body: { messages: { content: string }[] } } | null = null;
    const out = { amounts: [], dates: [], merchantTerms: [], authorization: "authorized", credentialSharing: "unspecified", scamIndicators: [], findings: [], followUpQuestion: null };
    const p = new OpenAICompatibleReasoningProvider({ baseUrl: "https://api-inference.bitdeer.ai/v1/", apiKey: "k", model: "m", providerLabel: "bitdeer" }, async (url, init) => {
      sent = { url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }));
    });
    await p.interpret({ ...ctx, statement: { ...ctx.statement, text: "Me." }, questionAsked: "Did you personally enter and send this payment, or did someone else do that?" });
    expect(sent!.url).toBe("https://api-inference.bitdeer.ai/v1/chat/completions");
    expect(sent!.auth).toBe("Bearer k");
    expect(JSON.parse(sent!.body.messages[1]!.content)).toMatchObject({ statement: "Me.", questionAsked: expect.stringContaining("personally enter and send") });
  });
});

describe("redaction and idempotency", () => {
  it("redacts keys and tokens", () => {
    expect(redact("GET /x?key=abc123&y=1 Bearer sk_car_zzz")).toBe("GET /x?key=[REDACTED]&y=1 Bearer [REDACTED]");
  });

  it("produces stable voice keys for retried events, scoped to the question answered", async () => {
    const u = await voiceUtteranceKey("It was  $49 ");
    expect(await voiceUtteranceKey("it was $49")).toBe(u);
    expect(await voiceUtteranceKey("it was $49", "turn-7")).not.toBe(u);
    const a = voiceIdempotencyKey("ac_1", "turnA", u);
    expect(voiceIdempotencyKey("ac_1", "turnA", u)).toBe(a); // retry
    expect(voiceIdempotencyKey("ac_1", "turnB", u)).not.toBe(a); // same words, different question
    expect(voiceIdempotencyKey("ac_2", "turnA", u)).not.toBe(a);
    expect(voiceIdempotencyKey("ac_1", null, u)).toBe(`voice:ac_1:start:${u}`);
  });
});
