import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCase, type CaseAnalysis } from "@/lib/domain/workflow";
import { evaluateAutoApproval } from "@/lib/domain/autoApproval";
import { FRAUD_FINDER_PRODUCT, IDENTITY_PRODUCT } from "@/lib/domain/fraudSignals";
import { getCrsPersona } from "@/lib/fixtures/crsPersonas";
import { DEMO_PERSONAS, getDemoPersona, personaPurchaseFor, type DemoPersona } from "@/lib/fixtures/demoPersonas";
import type { ProviderEvidence, Statement, TransactionEvidence } from "@/lib/domain/schemas";
import { NOW, replyTo, resetStatements, stmt, txn } from "./helpers/build";

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

/** Plays the persona's script: the first line opens the call, each later line answers the question the backend asks next. */
function playScript(p: DemoPersona) {
  const transactions = ledger(p);
  const providerEvidence = crsEvidence(p.crsPersonaId);
  const statements: Statement[] = [];
  const analyze = (): CaseAnalysis => analyzeCase({ statements, transactions, providerEvidence, bankFetch: { ...ok, count: transactions.length } });
  for (const [i, line] of p.script.entries()) {
    const next = analyze().questions.find((q) => q.audience === "customer");
    statements.push(stmt(line, i === 0 ? {} : { replyTo: replyTo(next) }));
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
  return { analysis, evaluation, purchase, failed: evaluation.checks.filter((c) => !c.passed).map((c) => c.id) };
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
    const { evaluation, failed, purchase } = playScript(p);
    expect(purchase?.key, "matched record").toBe(p.expected.match === "none" ? undefined : p.disputedKey);
    expect(failed).toEqual(p.expected.failingChecks);
    expect(evaluation.eligible).toBe(p.expected.route === "auto_approve");
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
