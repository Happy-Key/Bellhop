import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseInput } from "@/lib/domain/workflow";
import { evaluateAutoApproval } from "@/lib/domain/autoApproval";
import { FRAUD_FINDER_PRODUCT, IDENTITY_PRODUCT } from "@/lib/domain/fraudSignals";
import { depositOnce, NessieClient, type NessieDeposit } from "@/lib/providers/nessie";
import { PAYMENT_ORIGIN_PRESETS, type PaymentOriginPreset } from "@/lib/fixtures/paymentOrigins";
import type { OpenQuestion, PaymentOrigin, ProviderEvidence, Statement, TransactionEvidence } from "@/lib/domain/schemas";
import { LEDGER, NOW, replyTo, resetStatements, stmt, txn } from "./helpers/build";

const ok = { status: "ok", at: NOW, count: LEDGER.length } as const;
const crs = (product: string, field: string, value: string, suffix: string): ProviderEvidence => ({ ref: `X:crs:P01:k1:${suffix}`, provider: "crs", product, field, value, syntheticAssociation: true });
/** A clean identity check and a low Fraud Finder score: the evidence a fully verified claim has. */
const CLEAN_CRS = [crs(IDENTITY_PRODUCT, "verification_messages", "none returned (identity elements verified)", "result"), crs(FRAUD_FINDER_PRODUCT, "risk_score", "11", "ff-score")];

interface Over {
  transactions?: TransactionEvidence[];
  prior?: { caseId: string; txnRef: string; amount: number; outcome: string }[];
  providerEvidence?: ProviderEvidence[];
  origin?: PaymentOriginPreset | null;
}
const evaluate = (statements: Statement[], over: Over = {}) => {
  const input: CaseInput = { statements, transactions: over.transactions ?? LEDGER, providerEvidence: over.providerEvidence ?? CLEAN_CRS, bankFetch: ok };
  const analysis = analyzeCase(input);
  const preset = over.origin === undefined ? "new_device_far_away" : over.origin;
  const paymentOrigin: PaymentOrigin | null =
    preset && analysis.match.matchedRef ? { txnRef: analysis.match.matchedRef, ...PAYMENT_ORIGIN_PRESETS[preset].origin, synthetic: true } : null;
  return evaluateAutoApproval({ analysis, transactions: input.transactions, statements, providerEvidence: input.providerEvidence, paymentOrigin, homeState: "CA", priorReimbursements: over.prior ?? [] });
};
const failed = (e: ReturnType<typeof evaluate>) => e.checks.filter((c) => !c.passed).map((c) => c.id);
const CLAIM = "I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.";

describe("automatic approval policy (approve-only)", () => {
  beforeEach(resetStatements);

  it("approves a clear, small, unauthorized debit reported in time, once the evidence backs it", () => {
    const e = evaluate([stmt(CLAIM)]);
    expect(failed(e)).toEqual([]);
    expect(e).toMatchObject({ eligible: true, txnRef: "T:eee555", amount: 23, policy: "AUTO-1@2026-10-24.3" });
    expect(e.checks).toHaveLength(15);
  });

  it("never pays the same payment twice: an approval on another case, or our SIMULATED deposit for it, sends the claim to a person", () => {
    const onOtherCase = evaluate([stmt(CLAIM)], { prior: [{ caseId: "case-a", txnRef: "T:eee555", amount: 23, outcome: "auto_approved" }] });
    expect(failed(onOtherCase)).toEqual(["not_already_reimbursed"]);
    expect(onOtherCase.checks.find((c) => c.id === "not_already_reimbursed")?.detail).toMatch(/already reimbursed: \$23\.00 auto approved on case case-a/);
    resetStatements();
    // An approval for a different payment doesn't count.
    expect(failed(evaluate([stmt(CLAIM)], { prior: [{ caseId: "case-a", txnRef: "T:aaa111", amount: 64, outcome: "auto_approved" }] }))).toEqual([]);
    resetStatements();
    // After a database reset only the bank's record is left: our payout deposit for this payment.
    const payout: TransactionEvidence = { ...txn("dep-1", 23, "2026-10-23", ""), kind: "deposit", merchantId: null, merchantName: null, description: "SIMULATED reimbursement for T:eee555, auto-approved under AUTO-1@2026-10-24.2 [claim k123]" };
    expect(failed(evaluate([stmt(CLAIM)], { transactions: [...LEDGER, payout] }))).toEqual(["not_already_reimbursed"]);
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

  it("never approves a payment that isn't in the bank records, or before records are retrieved", () => {
    const e = evaluate([stmt("I did not make the $57 purchase at Sushi Palace. I never shared my card or codes.")]);
    expect(e).toMatchObject({ eligible: false, txnRef: null, amount: null });
    expect(failed(e)).toEqual(expect.arrayContaining(["ready_for_reimbursement_review", "amount_within_limit", "electronic_debit", "payment_origin_supports_claim"]));
    expect(e.checks.find((c) => c.id === "ready_for_reimbursement_review")?.detail).toMatch(/request clarification/);

    resetStatements();
    const s = [stmt(CLAIM)];
    const notRetrieved = evaluateAutoApproval({
      analysis: analyzeCase({ statements: s, transactions: [], providerEvidence: CLEAN_CRS, bankFetch: { status: "never" } }),
      transactions: [], statements: s, providerEvidence: CLEAN_CRS, paymentOrigin: null, homeState: "CA",
    });
    expect(notRetrieved.eligible).toBe(false);
    expect(notRetrieved.checks.find((c) => c.id === "ready_for_reimbursement_review")?.detail).toMatch(/further investigation.*not been retrieved/);
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

describe("questions tailored to what automatic approval needs", () => {
  beforeEach(resetStatements);
  const ask = (statements: Statement[], pick: (q: OpenQuestion) => boolean) => replyTo(analyzeCase({ statements, transactions: LEDGER, providerEvidence: CLEAN_CRS, bankFetch: ok }).questions.find(pick));

  it("two amounts in one statement: confirms the one bank record instead of blocking for good", () => {
    const s1 = stmt("I did not make the $23 purchase at Corner Grocer, and now my balance is $12.");
    expect(failed(evaluate([s1]))).toContain("ready_for_reimbursement_review");
    const asked = ask([s1], (q) => q.kind === "multiple_amounts");
    expect(asked).toMatchObject({ key: "tentative:T:eee555" });
    expect(asked.text).toMatch(/Is the payment you're disputing the \$23\.00 payment to FCI Demo Corner Grocer on 2026-10-22\?/);
    expect(evaluate([s1, stmt("Yes, that one", { replyTo: asked })]).eligible).toBe(true);

    // Restating the amount settles it rather than creating an amount conflict.
    resetStatements();
    const s1b = stmt("I did not make the $23 purchase at Corner Grocer, and now my balance is $12.");
    const e = evaluate([s1b, stmt("Yes, the $23 one", { replyTo: asked })]);
    expect(failed(e)).toEqual([]);
  });

  it("asked for a code but gave nothing: approved once the customer says so", () => {
    const s1 = stmt("Someone pretending to be my bank called me. I did not make the $23 purchase at Corner Grocer.");
    expect(failed(evaluate([s1]))).toEqual(["no_scam_contact_reported"]);
    const asked = ask([s1], (q) => q.key === "credentials");
    expect(asked.text).toMatch(/did you give anyone a code/);
    expect(evaluate([s1, stmt("They asked for a code but I didn't give it to them", { replyTo: asked })]).eligible).toBe(true);
  });

  it("asks who made the payment by naming it, and reads a plain 'No.' as someone else", () => {
    const s1 = stmt("There's a $23 charge at Corner Grocer");
    const asked = ask([s1], (q) => q.key === "initiation");
    expect(asked.text).toBe("Did you make the $23.00 payment to FCI Demo Corner Grocer on 2026-10-22 yourself, or did someone else make it?");
    expect(evaluate([s1, stmt("No.", { replyTo: asked })]).eligible).toBe(true);
  });

  it("two possible records: asks about one by name, and 'no' leaves the other as the match", () => {
    const s1 = stmt("There's a $49 charge I don't recognize");
    const asked = ask([s1], (q) => q.kind === "ambiguous_match");
    expect(asked).toMatchObject({ key: "tentative:T:ccc333" });
    expect(asked.text).toBe("I found 2 payments that could match. Is it the $49.00 payment to FCI Demo GiftCard Hub on 2026-10-19?");
    const e = evaluate([s1, stmt("No, it's the other one", { replyTo: asked })]);
    expect(e).toMatchObject({ eligible: true, txnRef: "T:ddd444" });
  });

  it("no details yet: asks for the exact amount first, and skips a detail the customer doesn't know", () => {
    const s1 = stmt("There's a charge on my account I don't recognize");
    const amount = ask([s1], (q) => q.kind === "missing_transaction_details");
    expect(amount).toMatchObject({ key: "details:amount" });
    expect(amount.text).toMatch(/exact amount of the payment, including cents/);
    const s2 = stmt("I don't know", { replyTo: amount });
    expect(ask([s1, s2], (q) => q.kind === "missing_transaction_details")).toMatchObject({ key: "details:merchant" });

    resetStatements();
    const s1b = stmt("There's a charge on my account I don't recognize");
    expect(evaluate([s1b, stmt("It was $23", { replyTo: amount })]).eligible).toBe(true);
  });

  it("'I sent it' read from the account itself is read back, so a misread denial still gets approved", () => {
    // The scripted extractor reads this as "I authorized it" (seen live 2026-10-24).
    const s1 = stmt("I do not believe I authorized the $23 charge at Corner Grocer.");
    expect(analyzeCase({ statements: [s1], transactions: LEDGER, providerEvidence: CLEAN_CRS, bankFetch: ok }).facts.authorization?.value).toBe("authorized");
    const asked = ask([s1], (q) => q.key === "confirm:authorization");
    expect(asked.text).toBe("Just to check I have this right: did you make the $23.00 payment to FCI Demo Corner Grocer on 2026-10-22 yourself? If someone else made it, please say so.");
    const e = evaluate([s1, stmt("No, someone else made it", { replyTo: asked })]);
    expect(failed(e)).toEqual([]);
  });
});
