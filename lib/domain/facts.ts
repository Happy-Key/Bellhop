/**
 * Aggregate customer-reported facts across statements.
 *
 * Original statements are never modified. When statement B corrects statement A, B's
 * values replace A's values for any field B provides. Uncorrected disagreements between
 * statements are surfaced as conflicts, never resolved silently.
 */
import type { AnswerState, AuthorizationClaim, CredentialSharing, Statement } from "./schemas";

export interface ReportedValue<T> {
  value: T;
  statementRef: string;
}

export interface FactConflict {
  field: "amount" | "date" | "authorization" | "credentialSharing";
  values: ReportedValue<string>[];
}

export interface ClaimFacts {
  amounts: ReportedValue<number>[];
  dates: ReportedValue<string>[];
  merchantTerms: ReportedValue<string>[];
  authorization: ReportedValue<AuthorizationClaim> | null;
  credentialSharing: ReportedValue<CredentialSharing> | null;
  scamIndicators: ReportedValue<string>[];
  conflicts: FactConflict[];
  /** Statement refs whose fields were superseded by a later correction. */
  superseded: { ref: string; by: string; fields: string[] }[];
  uninterpretedRefs: string[];
  /** Customer's latest yes/no on a candidate transaction, by transaction ref. */
  txnDecisions: { txnRef: string; decision: "confirmed" | "rejected"; statementRef: string }[];
  /** Latest answer state per question key (unknown/declined answers stop a question being re-asked). */
  answers: { key: string; state: AnswerState; statementRef: string }[];
}

type Field = "amounts" | "dates" | "merchantTerms" | "authorization" | "credentialSharing";

export function aggregateFacts(statements: Statement[]): ClaimFacts {
  const ordered = [...statements].sort((a, b) => a.receivedAt - b.receivedAt);
  // field -> refs whose values are overridden for that field
  const overridden = new Map<Field, Set<string>>();
  const superseded: ClaimFacts["superseded"] = [];

  for (const s of ordered) {
    if (!s.correctsRef || !s.interpretation) continue;
    const i = s.interpretation;
    const fields: Field[] = [];
    if (i.amounts.length) fields.push("amounts");
    if (i.dates.length) fields.push("dates");
    if (i.merchantTerms.length) fields.push("merchantTerms");
    if (i.authorization !== "unspecified") fields.push("authorization");
    if (i.credentialSharing !== "unspecified") fields.push("credentialSharing");
    for (const f of fields) {
      const set = overridden.get(f) ?? new Set<string>();
      set.add(s.correctsRef);
      overridden.set(f, set);
    }
    if (fields.length) superseded.push({ ref: s.correctsRef, by: s.ref, fields });
  }

  // A reply to a question that asks the customer to settle a field, and that gives a value for it,
  // supersedes earlier statements' values for that field (originals preserved):
  //  - "conflict:<field>" and the read-back "confirm:<field>";
  //  - questions about which payment it was ("tentative:<ref>", "multiple_amounts:<ref>", "no_match"),
  //    whose replies often restate the amount or date ("yes, the $389 one").
  const CONFLICT_FIELD: Record<string, Field> = { amount: "amounts", date: "dates", authorization: "authorization", credentialSharing: "credentialSharing" };
  const settles = (key: string): Field[] => {
    const m = key.match(/^(?:conflict|confirm):(.+)$/);
    if (m) return CONFLICT_FIELD[m[1]!] ? [CONFLICT_FIELD[m[1]!]!] : [];
    return /^(?:tentative:|multiple_amounts:|no_match$)/.test(key) ? ["amounts", "dates"] : [];
  };
  const provides = (s: Statement, field: Field): boolean => {
    const i = s.interpretation;
    const d = s.answer?.derived;
    if (field === "amounts") return !!i?.amounts.length;
    if (field === "dates") return !!i?.dates.length;
    if (field === "merchantTerms") return !!i?.merchantTerms.length;
    if (field === "authorization") return (!!i && i.authorization !== "unspecified") || !!d?.authorization;
    return (!!i && i.credentialSharing !== "unspecified") || !!d?.credentialSharing;
  };
  for (const [idx, s] of ordered.entries()) {
    for (const field of s.inResponseTo ? settles(s.inResponseTo.key) : []) {
      if (!provides(s, field)) continue;
      // A "yes, I sent it" read-back agrees with the earlier account and keeps its detail (sent after being deceived).
      const auth = s.interpretation?.authorization !== "unspecified" ? s.interpretation?.authorization : s.answer?.derived?.authorization;
      if (field === "authorization" && s.inResponseTo!.key.startsWith("confirm:") && auth !== "denies_authorization") continue;
      const set = overridden.get(field) ?? new Set<string>();
      for (const earlier of ordered.slice(0, idx)) {
        if (!provides(earlier, field) || set.has(earlier.ref)) continue;
        set.add(earlier.ref);
        superseded.push({ ref: earlier.ref, by: s.ref, fields: [field] });
      }
      overridden.set(field, set);
    }
  }

  const live = (f: Field, ref: string) => !overridden.get(f)?.has(ref);
  const facts: ClaimFacts = {
    amounts: [], dates: [], merchantTerms: [], authorization: null, credentialSharing: null,
    scamIndicators: [], conflicts: [], superseded, uninterpretedRefs: [], txnDecisions: [], answers: [],
  };
  const authValues: ReportedValue<AuthorizationClaim>[] = [];
  const credValues: ReportedValue<CredentialSharing>[] = [];
  const decisions = new Map<string, ClaimFacts["txnDecisions"][number]>();
  const answers = new Map<string, ClaimFacts["answers"][number]>();

  for (const s of ordered) {
    // Values read from a short reply in the context of its question (rule-based; see answers.ts).
    const d = s.answer?.derived;
    if (s.answer) answers.set(s.answer.key, { key: s.answer.key, state: s.answer.state, statementRef: s.ref });
    if (d?.confirmsTxnRef) decisions.set(d.confirmsTxnRef, { txnRef: d.confirmsTxnRef, decision: "confirmed", statementRef: s.ref });
    if (d?.rejectsTxnRef) decisions.set(d.rejectsTxnRef, { txnRef: d.rejectsTxnRef, decision: "rejected", statementRef: s.ref });

    const i = s.interpretation;
    if (!i) facts.uninterpretedRefs.push(s.ref);
    const auth = i && i.authorization !== "unspecified" ? i.authorization : d?.authorization;
    const cred = i && i.credentialSharing !== "unspecified" ? i.credentialSharing : d?.credentialSharing;
    if (live("authorization", s.ref) && auth && auth !== "unspecified") authValues.push({ value: auth, statementRef: s.ref });
    if (live("credentialSharing", s.ref) && cred && cred !== "unspecified") credValues.push({ value: cred, statementRef: s.ref });
    if (!i) continue;
    if (live("amounts", s.ref)) for (const a of i.amounts) facts.amounts.push({ value: a, statementRef: s.ref });
    if (live("dates", s.ref)) for (const dt of i.dates) facts.dates.push({ value: dt, statementRef: s.ref });
    if (live("merchantTerms", s.ref)) for (const t of i.merchantTerms) facts.merchantTerms.push({ value: t, statementRef: s.ref });
    for (const x of i.scamIndicators) facts.scamIndicators.push({ value: x, statementRef: s.ref });
  }
  facts.txnDecisions = [...decisions.values()];
  facts.answers = [...answers.values()];

  const distinct = <T>(vals: ReportedValue<T>[]) => new Set(vals.map((v) => String(v.value))).size;
  const asStrings = <T>(vals: ReportedValue<T>[]) => vals.map((v) => ({ value: String(v.value), statementRef: v.statementRef }));

  // Different amounts / dates in different statements conflict (this slice handles one disputed transaction per case).
  const amountRefs = new Set(facts.amounts.map((a) => a.statementRef));
  if (distinct(facts.amounts) > 1 && amountRefs.size > 1) facts.conflicts.push({ field: "amount", values: asStrings(facts.amounts) });
  const dateRefs = new Set(facts.dates.map((a) => a.statementRef));
  if (distinct(facts.dates) > 1 && dateRefs.size > 1) facts.conflicts.push({ field: "date", values: asStrings(facts.dates) });

  // "I sent it" and "I sent it after being tricked" both say the customer sent the payment: not a conflict.
  const authSet = new Set(authValues.map((v) => v.value));
  const customerSentOnly = [...authSet].every((v) => v === "authorized" || v === "authorized_induced");
  if (authSet.size > 1 && customerSentOnly) facts.authorization = authValues.filter((v) => v.value === "authorized_induced").at(-1) ?? null;
  else if (distinct(authValues) > 1) facts.conflicts.push({ field: "authorization", values: asStrings(authValues) });
  else facts.authorization = authValues.at(-1) ?? null;
  if (distinct(credValues) > 1) facts.conflicts.push({ field: "credentialSharing", values: asStrings(credValues) });
  else facts.credentialSharing = credValues.at(-1) ?? null;

  return facts;
}
