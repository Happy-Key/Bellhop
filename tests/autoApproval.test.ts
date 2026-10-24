import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseInput } from "@/lib/domain/workflow";
import { evaluateAutoApproval } from "@/lib/domain/autoApproval";
import { FRAUD_FINDER_PRODUCT, IDENTITY_PRODUCT } from "@/lib/domain/fraudSignals";
import { depositOnce, NessieClient, type NessieDeposit } from "@/lib/providers/nessie";
import { PAYMENT_ORIGIN_PRESETS, type PaymentOriginPreset } from "@/lib/fixtures/paymentOrigins";
import type { PaymentOrigin, ProviderEvidence, Statement, TransactionEvidence } from "@/lib/domain/schemas";
import { LEDGER, NOW, resetStatements, stmt, txn } from "./helpers/build";

const ok = { status: "ok", at: NOW, count: LEDGER.length } as const;
const crs = (product: string, field: string, value: string, suffix: string): ProviderEvidence => ({ ref: `X:crs:P01:k1:${suffix}`, provider: "crs", product, field, value, syntheticAssociation: true });
/** A clean identity check and a low Fraud Finder score: the evidence a fully verified claim has. */
const CLEAN_CRS = [crs(IDENTITY_PRODUCT, "verification_messages", "none returned (identity elements verified)", "result"), crs(FRAUD_FINDER_PRODUCT, "risk_score", "11", "ff-score")];

interface Over {
  transactions?: TransactionEvidence[];
  providerEvidence?: ProviderEvidence[];
  origin?: PaymentOriginPreset | null;
}
const evaluate = (statements: Statement[], over: Over = {}) => {
  const input: CaseInput = { statements, transactions: over.transactions ?? LEDGER, providerEvidence: over.providerEvidence ?? CLEAN_CRS, bankFetch: ok };
  const analysis = analyzeCase(input);
  const preset = over.origin === undefined ? "new_device_far_away" : over.origin;
  const paymentOrigin: PaymentOrigin | null =
    preset && analysis.match.matchedRef ? { txnRef: analysis.match.matchedRef, ...PAYMENT_ORIGIN_PRESETS[preset].origin, synthetic: true } : null;
  return evaluateAutoApproval({ analysis, transactions: input.transactions, statements, providerEvidence: input.providerEvidence, paymentOrigin, homeState: "CA" });
};
const failed = (e: ReturnType<typeof evaluate>) => e.checks.filter((c) => !c.passed).map((c) => c.id);
const CLAIM = "I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.";

describe("automatic approval policy (approve-only)", () => {
  beforeEach(resetStatements);

  it("approves a clear, small, unauthorized debit reported in time, once the evidence backs it", () => {
    const e = evaluate([stmt(CLAIM)]);
    expect(failed(e)).toEqual([]);
    expect(e).toMatchObject({ eligible: true, txnRef: "T:eee555", amount: 23, policy: "AUTO-1@2026-10-24.2" });
    expect(e.checks).toHaveLength(14);
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

describe("verifying the claim against evidence (policy version 2)", () => {
  beforeEach(resetStatements);

  it("needs a record of how the payment was made, and one that doesn't point to the customer", () => {
    expect(failed(evaluate([stmt(CLAIM)], { origin: null }))).toEqual(["payment_origin_supports_claim"]);
    resetStatements();
    const own = evaluate([stmt(CLAIM)], { origin: "customer_device" });
    expect(failed(own)).toEqual(["payment_origin_supports_claim"]);
    expect(own.checks.find((c) => c.id === "payment_origin_supports_claim")?.detail).toMatch(/enrolled device after a passed two-factor check/);
    resetStatements();
    expect(failed(evaluate([stmt(CLAIM)], { origin: "chip_and_pin_near_home" }))).toEqual(["payment_origin_supports_claim"]);
  });

  it("flags a merchant the customer has paid before", () => {
    const ledger = [txn("aaa111", 64, "2026-10-14", "FCI Demo Corner Grocer"), txn("eee555", 23, "2026-10-22", "FCI Demo Corner Grocer")].map((t) => ({ ...t, merchantId: "m-grocer" }));
    const e = evaluate([stmt(CLAIM)], { transactions: ledger });
    expect(failed(e)).toEqual(["no_prior_payments_to_merchant"]);
    expect(e.checks.find((c) => c.id === "no_prior_payments_to_merchant")?.detail).toMatch(/1 other time\(s\) \(2026-10-14 \$64\.00\)/);
  });

  it("flags a deposit that looks like a refund, but not our own SIMULATED payout, and never matches a deposit as the payment", () => {
    const deposit = (id: string, description: string): TransactionEvidence => ({ ...txn(id, 23, "2026-10-23", ""), kind: "deposit", merchantId: null, merchantName: null, description });
    const refund = evaluate([stmt(CLAIM)], { transactions: [...LEDGER, deposit("dep1", "Refund from Corner Grocer")] });
    expect(failed(refund)).toEqual(["no_refund_received"]);
    expect(refund.txnRef).toBe("T:eee555");
    resetStatements();
    const ours = evaluate([stmt(CLAIM)], { transactions: [...LEDGER, deposit("dep2", "SIMULATED reimbursement for T:eee555 [claim d1]")] });
    expect(failed(ours)).toEqual([]);
  });

  it("requires an identity check that actually ran and came back clear", () => {
    expect(failed(evaluate([stmt(CLAIM)], { providerEvidence: [CLEAN_CRS[1]!] }))).toEqual(["identity_check_clear"]);
    resetStatements();
    const issues = [...CLEAN_CRS, crs(IDENTITY_PRODUCT, "message_2201", "SSN issued to a different name", "msg1")];
    expect(failed(evaluate([stmt(CLAIM)], { providerEvidence: issues }))).toEqual(expect.arrayContaining(["identity_check_clear"]));
  });

  it("requires a Fraud Finder score in the low band (30 or less)", () => {
    expect(failed(evaluate([stmt(CLAIM)], { providerEvidence: [CLEAN_CRS[0]!] }))).toEqual(["fraud_risk_low"]);
    resetStatements();
    const medium = [CLEAN_CRS[0]!, crs(FRAUD_FINDER_PRODUCT, "risk_score", "50", "ff-score")];
    const e = evaluate([stmt(CLAIM)], { providerEvidence: medium });
    expect(failed(e)).toEqual(["fraud_risk_low"]);
    expect(e.checks.find((c) => c.id === "fraud_risk_low")?.detail).toMatch(/risk score 50 \(medium/);
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
