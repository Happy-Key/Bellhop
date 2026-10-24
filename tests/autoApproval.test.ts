import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseInput } from "@/lib/domain/workflow";
import { evaluateAutoApproval } from "@/lib/domain/autoApproval";
import { depositOnce, NessieClient, type NessieDeposit } from "@/lib/providers/nessie";
import type { Statement } from "@/lib/domain/schemas";
import { LEDGER, NOW, resetStatements, stmt } from "./helpers/build";

const ok = { status: "ok", at: NOW, count: LEDGER.length } as const;
const evaluate = (statements: Statement[], over: Partial<CaseInput> = {}) => {
  const input: CaseInput = { statements, transactions: LEDGER, providerEvidence: [], bankFetch: ok, ...over };
  return evaluateAutoApproval({ analysis: analyzeCase(input), transactions: input.transactions, statements });
};
const failed = (e: ReturnType<typeof evaluate>) => e.checks.filter((c) => !c.passed).map((c) => c.id);

describe("automatic approval policy (approve-only)", () => {
  beforeEach(resetStatements);

  it("approves a clear, small, unauthorized debit reported in time", () => {
    const e = evaluate([stmt("I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.")]);
    expect(failed(e)).toEqual([]);
    expect(e).toMatchObject({ eligible: true, txnRef: "T:eee555", amount: 23, policy: "AUTO-1@2026-10-24" });
  });

  it("sends anything over the $100 limit to a person", () => {
    const e = evaluate([stmt("I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.")]);
    expect(e.eligible).toBe(false);
    expect(failed(e)).toEqual(["amount_within_limit"]);
  });

  it("sends shared credentials and reported scam contact to a person", () => {
    expect(failed(evaluate([stmt("I did not make the $23 purchase at Corner Grocer. I gave them the code from my text")]))).toContain("no_credentials_shared");
    resetStatements();
    expect(failed(evaluate([stmt("Someone pretending to be the bank called. I did not make the $23 purchase at Corner Grocer.")]))).toEqual(["no_scam_contact_reported"]);
  });

  it("never approves a customer-sent payment, an unmatched one, or one still being interpreted", () => {
    expect(evaluate([stmt("I paid $23 at Corner Grocer myself")]).eligible).toBe(false);
    resetStatements();
    expect(failed(evaluate([stmt("There's a $49 charge I don't recognize")]))).toEqual(expect.arrayContaining(["ready_for_reimbursement_review", "amount_within_limit"]));
    resetStatements();
    const pending = { ...stmt("I did not make the $23 purchase at Corner Grocer. I never shared my card or codes."), interpretation: null };
    expect(failed(evaluate([pending]))).toContain("all_statements_interpreted");
  });

  it("requires the first report within 60 days of the transaction", () => {
    const late = stmt("I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.", { at: Date.UTC(2027, 0, 5) });
    expect(failed(evaluate([late]))).toEqual(["reported_in_time"]);
  });

  it("never denies: an ineligible claim has failed checks to show, not a denial", () => {
    const e = evaluate([stmt("I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.")]);
    expect(JSON.stringify(e)).not.toMatch(/deni(ed|al)/i);
  });
});

describe("SIMULATED payout deposits at most once", () => {
  const ACCOUNT = "acc-0000-1111-2222";
  const deposit = { amount: 23, date: "2026-10-24", description: "SIMULATED reimbursement for T:eee555 [claim d1]", marker: "[claim d1]" };

  it("creates a deposit when none carries the marker", async () => {
    const calls: { method: string; body?: unknown }[] = [];
    const client = new NessieClient("k", "https://api.example.invalid", async (_url, init) => {
      calls.push({ method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return init?.method === "POST"
        ? new Response(JSON.stringify({ code: 201, message: "Created deposit", objectCreated: { _id: "dep-0000-0001" } }), { status: 201 })
        : new Response("[]", { status: 200 });
    });
    expect(await depositOnce(client, ACCOUNT, deposit)).toEqual({ depositId: "dep-0000-0001", reused: false });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[1]?.body).toEqual({ medium: "balance", transaction_date: "2026-10-24", status: "completed", amount: 23, description: deposit.description });
  });

  it("reuses an earlier deposit instead of paying twice", async () => {
    const earlier: NessieDeposit = { _id: "dep-earlier-01", amount: 23, description: deposit.description };
    let posts = 0;
    const client = new NessieClient("k", "https://api.example.invalid", async (_url, init) => {
      if (init?.method === "POST") posts++;
      return new Response(JSON.stringify([earlier]), { status: 200 });
    });
    expect(await depositOnce(client, ACCOUNT, deposit)).toEqual({ depositId: "dep-earlier-01", reused: true });
    expect(posts).toBe(0);
  });

  it("refuses non-whole-dollar amounts (Nessie amounts are integers)", async () => {
    const client = new NessieClient("k", "https://api.example.invalid", async () => new Response("[]", { status: 200 }));
    await expect(depositOnce(client, ACCOUNT, { ...deposit, amount: 23.5 })).rejects.toMatchObject({ kind: "rejected_output" });
  });
});
