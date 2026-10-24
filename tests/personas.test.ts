import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseAnalysis } from "@/lib/domain/workflow";
import { evaluateAutoApproval } from "@/lib/domain/autoApproval";
import { FRAUD_FINDER_PRODUCT, IDENTITY_PRODUCT, isAppPayout } from "@/lib/domain/fraudSignals";
import { getCrsPersona } from "@/lib/fixtures/crsPersonas";
import { DEMO_PERSONAS, getDemoPersona, personaPurchaseFor, seedDifferences, type DemoPersona } from "@/lib/fixtures/demoPersonas";
import type { ProviderEvidence, Statement, TransactionEvidence } from "@/lib/domain/schemas";
import { NOW, replyTo, resetStatements, stmt, txn } from "./helpers/build";
import { answerRuleQuestion } from "@/lib/fixtures/customerSim";

const DAY = 86_400_000;
const ok = { status: "ok", at: NOW, count: 0 } as const;

const dateAgo = (days: number) => new Date(NOW - days * DAY).toISOString().slice(0, 10);

/** The persona's account as Nessie returns it: purchases (one merchant id per merchant) and deposits. */
const ledger = (p: DemoPersona): TransactionEvidence[] => [
  ...p.purchases.map((x) => ({ ...txn(`${p.id}-${x.key}`, x.amount, dateAgo(x.daysAgo), x.merchant), merchantId: `m-${p.id}-${x.merchant}` })),
  ...(p.deposits ?? []).map((d) => ({ ...txn(`${p.id}-${d.key}`, d.amount, dateAgo(d.daysAgo), ""), kind: "deposit" as const, merchantId: null, merchantName: null, description: d.description })),
];

/** CRS results as the sandbox documents them for each test identity (lib/fixtures/crsPersonas.ts). */
function crsEvidence(crsId: string): ProviderEvidence[] {
  const crs = getCrsPersona(crsId)!;
  const row = (product: string, field: string, value: string, suffix: string): ProviderEvidence => ({ ref: `X:crs:${crsId}:k1:${suffix}`, provider: "crs", product, field, value, syntheticAssociation: true });
  const score = /risk\.score (\d+)/.exec(crs.fraudFinderExpected)![1]!;
  // "result FAIL. <issue>; <issue>" → one message row per issue. KBA_REQUIRED returns one step-up message
  // (as the live sandbox does for P16: "IDENTITY VERIFIED - STEP-UP AUTHENTICATION RECOMMENDED"). PASS returns none.
  const issues = crs.expected.startsWith("result FAIL")
    ? crs.expected.replace(/^result FAIL\.\s*/, "").split(";").map((m, i) => row(IDENTITY_PRODUCT, `message_${i + 1}`, m.trim(), `msg${i + 1}`))
    : crs.expected.startsWith("result KBA_REQUIRED")
      ? [row(IDENTITY_PRODUCT, "message_2401", "IDENTITY VERIFIED - STEP-UP AUTHENTICATION RECOMMENDED (FRAUD ALERT ON FILE)", "msg1")]
      : [];
  return [row(IDENTITY_PRODUCT, "verification_messages", issues.length ? "issues returned" : "none returned", "result"), ...issues, row(FRAUD_FINDER_PRODUCT, "risk_score", score, "ff-score")];
}

/**
 * Plays the persona's conversation: the customer opens, then answers whichever question the rules
 * actually ask next, from the persona's sheet (lib/fixtures/customerSim.ts). As on a call, a question
 * is asked at most twice. A question the sheet can't answer fails the test.
 */
function playScript(p: DemoPersona) {
  const transactions = ledger(p);
  const providerEvidence = crsEvidence(p.crsPersonaId);
  const statements: Statement[] = [stmt(p.customer.opening)];
  const analyze = (): CaseAnalysis => analyzeCase({ statements, transactions, providerEvidence, bankFetch: { ...ok, count: transactions.length } });
  const asked = new Map<string, number>();
  const transcript: string[] = [`Customer: ${p.customer.opening}`];
  for (let turn = 0; turn < 10; turn++) {
    const next = analyze().questions.find((q) => q.audience === "customer" && (asked.get(q.key) ?? 0) < 2);
    if (!next) break;
    asked.set(next.key, (asked.get(next.key) ?? 0) + 1);
    const answer = answerRuleQuestion(p, next);
    if (answer === null) throw new Error(`${p.id} has no answer for ${next.kind} (${next.key}): "${next.text}"`);
    transcript.push(`Assistant: ${next.text}`, `Customer: ${answer}`);
    statements.push(stmt(answer, { replyTo: replyTo(next) }));
  }
  const analysis = analyze();
  const matched = analysis.match.matchedRef ? transactions.find((t) => t.ref === analysis.match.matchedRef && t.kind === "purchase") : undefined;
  const purchase = matched ? personaPurchaseFor(p, matched) : undefined;
  const evaluation = evaluateAutoApproval({
    analysis,
    transactions,
    statements,
    providerEvidence,
    paymentOrigin: matched && purchase ? { txnRef: matched.ref, ...purchase.origin, synthetic: true } : null,
    homeState: p.home.state,
  });
  return { analysis, evaluation, purchase, transcript, failed: evaluation.checks.filter((c) => !c.passed).map((c) => c.id) };
}

describe("demo personas (SYNTHETIC)", () => {
  beforeEach(resetStatements);

  it("are internally consistent: unique ids and amounts, a disputed purchase, a published CRS identity", () => {
    expect(new Set(DEMO_PERSONAS.map((p) => p.id)).size).toBe(DEMO_PERSONAS.length);
    for (const p of DEMO_PERSONAS) {
      expect(getCrsPersona(p.crsPersonaId), p.id).toBeDefined();
      expect(getCrsPersona(p.crsPersonaId)!.identityBody.state).toBe(p.home.state);
      expect(new Set(p.purchases.map((x) => x.amount)).size, `${p.id} amounts`).toBe(p.purchases.length);
      for (const key of [p.disputedKey, ...(p.alsoDisputedKeys ?? [])]) expect(p.purchases.some((x) => x.key === key), `${p.id} disputed ${key}`).toBe(true);
      expect(p.expected.route === "auto_approve", `${p.id} route agrees with failing checks`).toBe(p.expected.failingChecks.length === 0);
      for (const x of p.purchases) {
        expect(Number.isInteger(x.amount) && x.amount > 0, `${p.id} ${x.key}`).toBe(true);
        expect(p.merchants.map((m) => m.name)).toContain(x.merchant);
      }
    }
    expect(getDemoPersona("nobody")).toBeUndefined();
    expect(getDemoPersona(null)).toBeUndefined();
  });

  // Every persona, core and suite: the script ends with exactly the expected AUTO-1 result.
  it.each(DEMO_PERSONAS.map((p) => [p.id, p] as const))("%s: ends with the expected AUTO-1 result", (_id, p) => {
    const { evaluation, failed, purchase, transcript } = playScript(p);
    if (process.env.SHOW_TRANSCRIPTS) console.log(`--- ${p.id}\n${transcript.join("\n")}\nfailed: ${failed.join(", ")}`);
    expect(purchase?.key, "matched record").toBe(p.expected.match === "none" ? undefined : p.disputedKey);
    expect(failed).toEqual(p.expected.failingChecks);
    expect(evaluation.eligible).toBe(p.expected.route === "auto_approve");
  });

  it("Elena: a customer disputing several payments is asked which one at most twice, however often she names them all", () => {
    const { transcript } = playScript(getDemoPersona("elena")!);
    expect(transcript.filter((l) => l.includes("Which single payment")).length).toBeLessThanOrEqual(2);
  });

  it("Margaret: the script ends in an automatic approval of the disputed $58", () => {
    const { evaluation, failed, purchase, analysis } = playScript(getDemoPersona("margaret")!);
    expect(failed).toEqual([]);
    expect(evaluation).toMatchObject({ eligible: true, amount: 58 });
    expect(purchase?.key).toBe("games");
    expect(analysis.questions.filter((q) => q.audience === "customer")).toEqual([]);
  });

  it("Grace: goes to a person only because the payment came from her own device", () => {
    const { evaluation, failed, purchase } = playScript(getDemoPersona("grace")!);
    expect(purchase?.key).toBe("homegoods");
    expect(evaluation.eligible).toBe(false);
    expect(failed).toEqual(["payment_origin_supports_claim"]);
  });

  it("Victor: goes to a person only because the identity check fails and Fraud Finder scores high", () => {
    const { evaluation, failed, purchase } = playScript(getDemoPersona("victor")!);
    expect(purchase?.key).toBe("rental");
    expect(evaluation.eligible).toBe(false);
    expect(failed).toEqual(["identity_check_clear", "fraud_risk_low"]);
  });

  it("Samuel: escalates to specialist scam review, and the script answers every question", () => {
    const { analysis, evaluation, purchase } = playScript(getDemoPersona("samuel")!);
    expect(purchase?.key).toBe("giftcard");
    expect(analysis.facts.authorization?.value).toBe("authorized_induced");
    expect(analysis.recommendation.action).toBe("escalate");
    expect(evaluation.eligible).toBe(false);
    expect(analysis.questions.filter((q) => q.audience === "customer")).toEqual([]);
  });
});

describe("persona accounts against their seeds (reset)", () => {
  const tomas = getDemoPersona("tomas")!;
  const seeded = [
    ...tomas.purchases.map((x) => ({ kind: "purchase", merchantName: x.merchant, amount: x.amount, description: x.description })),
    ...(tomas.deposits ?? []).map((d) => ({ kind: "deposit", merchantName: null, amount: d.amount, description: d.description })),
  ];

  it("an account exactly as seeded has no differences", () => {
    expect(seedDifferences(tomas, seeded)).toEqual([]);
  });

  it("names a leftover payout, a missing purchase, and a duplicate", () => {
    const payout = { kind: "deposit", merchantName: null, amount: 87, description: "SIMULATED reimbursement for T:x, auto-approved under AUTO-1 [claim k1]" };
    expect(seedDifferences(tomas, [...seeded, payout])).toEqual(["extra deposit SIMULATED reimbursement for T:x, auto-approved under AUTO-1 [claim k1] $87"]);
    expect(seedDifferences(tomas, seeded.slice(1))[0]).toMatch(/^missing purchase FCI Demo Pike Place Produce \$31/);
    expect(seedDifferences(tomas, [...seeded, seeded[0]!])).toContain("duplicate purchases");
  });

  it("recognizes only this app's payouts as deletable", () => {
    expect(isAppPayout("SIMULATED reimbursement for T:abc, auto-approved under AUTO-1@2026-10-24.3 [claim kd7]")).toBe(true);
    expect(isAppPayout("Refund from FCI Demo SkyHop Air")).toBe(false);
    expect(isAppPayout("SIMULATED reimbursement for T:abc")).toBe(false);
    expect(isAppPayout(null)).toBe(false);
  });
});
