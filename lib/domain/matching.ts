/**
 * Deterministic transaction matching (rule-based inference, not model reasoning).
 *
 * A match is only declared "clear" when exactly one transaction is plausible, it matches
 * the reported amount exactly, and no reported field contradicts it. Otherwise the
 * outcome asks for clarification instead of asserting a match.
 */
import type { ClaimFacts } from "./facts";
import type { TransactionEvidence } from "./schemas";

export const DATE_TOLERANCE_DAYS = 3;

export interface MatchReason {
  field: "amount" | "date" | "merchant" | "customer_confirmation";
  detail: string;
  statementRef: string;
}

export interface MatchCandidate {
  txnRef: string;
  score: number;
  amountMatch: boolean;
  dateDeltaDays: number | null;
  merchantMatch: boolean;
  reasons: MatchReason[];
  contradictions: string[];
}

export type MatchOutcome =
  | "insufficient_facts"
  | "no_transactions"
  | "no_match"
  | "tentative"
  | "ambiguous"
  | "clear";

export interface ExcludedCandidate {
  txnRef: string;
  reason: string;
}

export interface MatchResult {
  outcome: MatchOutcome;
  candidates: MatchCandidate[];
  /** Amount-plausible records dropped because they contradict another reported field. */
  excluded: ExcludedCandidate[];
  matchedRef: string | null;
}

function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Merchant matches when a significant token (≥4 chars) of the record's merchant appears in a reported term. */
export function merchantMatches(term: string, merchantName: string | null, description: string | null): boolean {
  const t = normalizeName(term);
  const hay = [merchantName, description].filter((x): x is string => !!x).map(normalizeName);
  return hay.some((h) => {
    if (!h) return false;
    if (h.includes(t) || t.includes(h)) return true;
    return h.split(" ").some((tok) => tok.length >= 4 && t.split(" ").includes(tok));
  });
}

export function matchTransactions(facts: ClaimFacts, allTxns: TransactionEvidence[]): MatchResult {
  // Deposits are money coming in (refunds, payouts), never the disputed payment.
  const txns = allTxns.filter((t) => t.kind !== "deposit");
  const hasFacts = facts.amounts.length > 0 || facts.dates.length > 0 || facts.merchantTerms.length > 0;
  if (!hasFacts) return { outcome: "insufficient_facts", candidates: [], excluded: [], matchedRef: null };
  if (txns.length === 0) return { outcome: "no_transactions", candidates: [], excluded: [], matchedRef: null };

  const candidates: MatchCandidate[] = [];
  for (const t of txns) {
    const reasons: MatchReason[] = [];
    const contradictions: string[] = [];
    let score = 0;

    const amt = facts.amounts.find((a) => Math.abs(a.value - t.amount) < 0.005);
    const amountMatch = !!amt;
    // Nessie may store whole-dollar amounts; a sub-dollar difference is plausible but never "clear".
    const approx = !amt && Number.isInteger(t.amount) ? facts.amounts.find((a) => Math.abs(a.value - t.amount) < 1) : undefined;
    if (amt) {
      score += 3;
      reasons.push({ field: "amount", detail: `amount $${t.amount.toFixed(2)} equals reported $${amt.value.toFixed(2)}`, statementRef: amt.statementRef });
    } else if (approx) {
      score += 2;
      reasons.push({ field: "amount", detail: `record amount $${t.amount} is within $1 of reported $${approx.value.toFixed(2)} (record stores whole dollars)`, statementRef: approx.statementRef });
      contradictions.push("amount matches only approximately");
    }

    let dateDeltaDays: number | null = null;
    if (t.date && facts.dates.length) {
      let best: { delta: number; ref: string; value: string } | null = null;
      for (const d of facts.dates) {
        const delta = daysBetween(d.value, t.date);
        if (!best || delta < best.delta) best = { delta, ref: d.statementRef, value: d.value };
      }
      if (best) {
        dateDeltaDays = best.delta;
        if (best.delta <= 1) {
          score += 2;
          reasons.push({ field: "date", detail: `record date ${t.date} within 1 day of reported ${best.value}`, statementRef: best.ref });
        } else if (best.delta <= DATE_TOLERANCE_DAYS) {
          score += 1;
          reasons.push({ field: "date", detail: `record date ${t.date} within ${best.delta} days of reported ${best.value}`, statementRef: best.ref });
        } else {
          contradictions.push(`record date ${t.date} is ${best.delta} days from reported ${best.value}`);
        }
      }
    }

    const merch = facts.merchantTerms.find((m) => merchantMatches(m.value, t.merchantName, t.description));
    const merchantMatch = !!merch;
    if (merch) {
      score += 2;
      reasons.push({ field: "merchant", detail: `merchant "${t.merchantName ?? t.description}" matches reported "${merch.value}"`, statementRef: merch.statementRef });
    }

    // Plausibility: if an amount was reported it must match exactly; otherwise need date or merchant support.
    const plausible = facts.amounts.length > 0 ? amountMatch || !!approx : reasons.length > 0;
    if (plausible) candidates.push({ txnRef: t.ref, score, amountMatch, dateDeltaDays, merchantMatch, reasons, contradictions });
  }

  // Consistency filter: if some candidates agree with a reported merchant / date, drop the ones
  // that don't. If none agree, nothing is dropped (the reported term may be noise).
  const excluded: ExcludedCandidate[] = [];
  // The customer said "no, not that one" to a candidate they were asked about.
  const rejected = new Map(facts.txnDecisions.filter((d) => d.decision === "rejected").map((d) => [d.txnRef, d.statementRef]));
  let remaining = candidates.filter((c) => {
    const by = rejected.get(c.txnRef);
    if (by) excluded.push({ txnRef: c.txnRef, reason: `customer said this is not the payment (${by})` });
    return !by;
  });
  const narrow = (field: "merchant" | "date", ok: (c: MatchCandidate) => boolean) => {
    if (remaining.length > 1 && remaining.some(ok)) {
      for (const c of remaining.filter((c) => !ok(c))) excluded.push({ txnRef: c.txnRef, reason: `inconsistent with reported ${field}` });
      remaining = remaining.filter(ok);
    }
  };
  narrow("merchant", (c) => c.merchantMatch);
  narrow("date", (c) => c.dateDeltaDays !== null && c.dateDeltaDays <= DATE_TOLERANCE_DAYS);

  remaining.sort((a, b) => b.score - a.score || a.txnRef.localeCompare(b.txnRef));

  // The customer confirmed a specific candidate ("yes, that one"): it is the match, labelled as such.
  const confirmation = facts.txnDecisions.find((d) => d.decision === "confirmed" && remaining.some((c) => c.txnRef === d.txnRef));
  if (confirmation) {
    const chosen = remaining.find((c) => c.txnRef === confirmation.txnRef)!;
    for (const c of remaining) if (c !== chosen) excluded.push({ txnRef: c.txnRef, reason: `customer confirmed ${chosen.txnRef} instead (${confirmation.statementRef})` });
    const confirmed: MatchCandidate = {
      ...chosen,
      reasons: [...chosen.reasons, { field: "customer_confirmation", detail: `customer confirmed this record when asked`, statementRef: confirmation.statementRef }],
    };
    return { outcome: "clear", candidates: [confirmed], excluded, matchedRef: chosen.txnRef };
  }

  const base = { candidates: remaining, excluded };

  if (remaining.length === 0) return { outcome: "no_match", ...base, matchedRef: null };
  if (remaining.length > 1) return { outcome: "ambiguous", ...base, matchedRef: null };
  const only = remaining[0]!;
  if (only.amountMatch && only.contradictions.length === 0) return { outcome: "clear", ...base, matchedRef: only.txnRef };
  return { outcome: "tentative", ...base, matchedRef: null };
}
