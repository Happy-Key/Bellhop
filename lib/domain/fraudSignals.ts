/**
 * Signals for checking a claim against evidence instead of taking the customer's word.
 *
 * A signal can only stop AUTOMATIC approval and send the claim to a person, with the evidence.
 * It never denies: under Regulation E the bank must investigate reasonably and bears the burden
 * of showing a transfer was authorized (15 U.S.C. 1693g(b); 12 CFR 1005.11(c)(4)).
 */
import type { PaymentOrigin, ProviderEvidence, TransactionEvidence } from "./schemas";
import { normalizeName } from "./matching";

/** CRS identity-check product id (lib/providers/crs.ts). */
export const IDENTITY_PRODUCT = "transunion-identity-manager-basic";
/** CRS Fraud Finder (AtData email risk) product id. */
export const FRAUD_FINDER_PRODUCT = "crs-fraud-finder-atdata";
/** CRS's own bands for risk.score (0-100): <=30 low, <=60 medium, else high. */
export const FRAUD_RISK_BANDS = { lowMax: 30, mediumMax: 60 } as const;

export function fraudRiskBand(score: number): "low" | "medium" | "high" {
  return score <= FRAUD_RISK_BANDS.lowMax ? "low" : score <= FRAUD_RISK_BANDS.mediumMax ? "medium" : "high";
}

/** Marker our own SIMULATED payouts carry (convex/payout.ts); they are not refunds. */
export const PAYOUT_MARKER = "[claim ";

export interface Signal {
  ok: boolean;
  detail: string;
}

/** Does the bank's record of how the payment was made support "someone else did it"? */
export function paymentOriginSignal(origin: PaymentOrigin | null, homeState: string): Signal {
  if (!origin) return { ok: false, detail: "No record of how the payment was made (device, login, location)." };
  const where = `${origin.city}, ${origin.state}${origin.state === homeState ? " (customer's home state)" : ""}`;
  if (origin.channel === "card_present_chip_pin") {
    return { ok: false, detail: `SYNTHETIC record: card present with chip and PIN in ${where}. Someone would need the card and the PIN.` };
  }
  if (origin.device === "customer_enrolled_device" && origin.twoFactor === "passed") {
    return { ok: false, detail: `SYNTHETIC record: made from the customer's enrolled device after a passed two-factor check, in ${where}. This contradicts "someone else made it".` };
  }
  return {
    ok: true,
    detail: `SYNTHETIC record: made from ${origin.device === "new_device" ? "a device never seen on this account" : "an unrecognized channel"}, two-factor ${origin.twoFactor.replace("_", " ")}, in ${where}.`,
  };
}

/** Has the customer paid this merchant before (other purchases on record)? */
export function merchantHistorySignal(txn: TransactionEvidence, all: TransactionEvidence[]): Signal {
  const sameMerchant = (t: TransactionEvidence) =>
    t.ref !== txn.ref && t.kind !== "deposit" && (txn.merchantId ? t.merchantId === txn.merchantId : !!txn.merchantName && t.merchantName === txn.merchantName);
  const others = all.filter(sameMerchant);
  if (!txn.merchantId && !txn.merchantName) return { ok: true, detail: "No merchant on record to compare." };
  if (others.length === 0) return { ok: true, detail: `No other payments to ${txn.merchantName ?? "this merchant"} on record.` };
  return {
    ok: false,
    detail: `Customer has paid ${txn.merchantName ?? "this merchant"} ${others.length} other time(s) (${others.map((t) => `${t.date ?? "?"} $${t.amount.toFixed(2)}`).join(", ")}).`,
  };
}

/** Is there a deposit after the payment that looks like a refund of it (excluding our own payouts)? */
export function refundSignal(txn: TransactionEvidence, all: TransactionEvidence[]): Signal {
  const merchantTokens = normalizeName(txn.merchantName ?? "").split(" ").filter((w) => w.length >= 4 && !["demo"].includes(w));
  const refunds = all.filter((d) => {
    if (d.kind !== "deposit" || (d.description ?? "").includes(PAYOUT_MARKER)) return false;
    if (txn.date && d.date && d.date < txn.date) return false;
    const desc = normalizeName(d.description ?? "");
    return Math.abs(d.amount - txn.amount) < 0.005 || merchantTokens.some((w) => desc.includes(w));
  });
  if (refunds.length === 0) return { ok: true, detail: "No deposit on record that looks like a refund." };
  return { ok: false, detail: `Possible refund already received: ${refunds.map((d) => `${d.date ?? "?"} $${d.amount.toFixed(2)} "${d.description ?? ""}"`).join("; ")}.` };
}

/** Has a CRS identity check run on the claimant, and did it come back clear? */
export function identitySignal(evidence: ProviderEvidence[]): Signal {
  const results = evidence.filter((p) => p.product === IDENTITY_PRODUCT && p.ref.endsWith(":result"));
  if (results.length === 0) return { ok: false, detail: "No identity check has been run on the claimant." };
  const issues = evidence.filter((p) => p.product === IDENTITY_PRODUCT && /:msg\d+$/.test(p.ref));
  if (issues.length > 0) return { ok: false, detail: `Identity check returned ${issues.length} issue(s) (SYNTHETIC test persona).` };
  return { ok: true, detail: "Identity check ran and verified the claimant's details (SYNTHETIC test persona)." };
}

/** Has CRS Fraud Finder scored the claimant's contact details, and is the risk low? */
export function fraudScoreSignal(evidence: ProviderEvidence[]): Signal {
  const row = evidence.find((p) => p.product === FRAUD_FINDER_PRODUCT && p.field === "risk_score");
  if (!row) return { ok: false, detail: "No Fraud Finder check has been run on the claimant's contact details." };
  const score = Number(row.value);
  if (!Number.isFinite(score)) return { ok: false, detail: `Fraud Finder returned an unreadable score (${row.value}).` };
  const band = fraudRiskBand(score);
  return {
    ok: band === "low",
    detail: `Fraud Finder risk score ${score} (${band}; automatic approval needs ${FRAUD_RISK_BANDS.lowMax} or less). SYNTHETIC test persona.`,
  };
}
