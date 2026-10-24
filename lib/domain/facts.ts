/**
 * Aggregate customer-reported facts across statements.
 *
 * Original statements are never modified. When statement B corrects statement A, B's
 * values replace A's values for any field B provides. Uncorrected disagreements between
 * statements are surfaced as conflicts, never resolved silently.
 */
import type { AuthorizationClaim, CredentialSharing, Statement } from "./schemas";

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

  const live = (f: Field, ref: string) => !overridden.get(f)?.has(ref);
  const facts: ClaimFacts = {
    amounts: [], dates: [], merchantTerms: [], authorization: null, credentialSharing: null,
    scamIndicators: [], conflicts: [], superseded, uninterpretedRefs: [],
  };
  const authValues: ReportedValue<AuthorizationClaim>[] = [];
  const credValues: ReportedValue<CredentialSharing>[] = [];

  for (const s of ordered) {
    const i = s.interpretation;
    if (!i) {
      facts.uninterpretedRefs.push(s.ref);
      continue;
    }
    if (live("amounts", s.ref)) for (const a of i.amounts) facts.amounts.push({ value: a, statementRef: s.ref });
    if (live("dates", s.ref)) for (const d of i.dates) facts.dates.push({ value: d, statementRef: s.ref });
    if (live("merchantTerms", s.ref)) for (const t of i.merchantTerms) facts.merchantTerms.push({ value: t, statementRef: s.ref });
    if (live("authorization", s.ref) && i.authorization !== "unspecified") authValues.push({ value: i.authorization, statementRef: s.ref });
    if (live("credentialSharing", s.ref) && i.credentialSharing !== "unspecified") credValues.push({ value: i.credentialSharing, statementRef: s.ref });
    for (const x of i.scamIndicators) facts.scamIndicators.push({ value: x, statementRef: s.ref });
  }

  const distinct = <T>(vals: ReportedValue<T>[]) => new Set(vals.map((v) => String(v.value))).size;
  const asStrings = <T>(vals: ReportedValue<T>[]) => vals.map((v) => ({ value: String(v.value), statementRef: v.statementRef }));

  // Different amounts / dates in different statements conflict (this slice handles one disputed transaction per case).
  const amountRefs = new Set(facts.amounts.map((a) => a.statementRef));
  if (distinct(facts.amounts) > 1 && amountRefs.size > 1) facts.conflicts.push({ field: "amount", values: asStrings(facts.amounts) });
  const dateRefs = new Set(facts.dates.map((a) => a.statementRef));
  if (distinct(facts.dates) > 1 && dateRefs.size > 1) facts.conflicts.push({ field: "date", values: asStrings(facts.dates) });

  if (distinct(authValues) > 1) facts.conflicts.push({ field: "authorization", values: asStrings(authValues) });
  else facts.authorization = authValues.at(-1) ?? null;
  if (distinct(credValues) > 1) facts.conflicts.push({ field: "credentialSharing", values: asStrings(credValues) });
  else facts.credentialSharing = credValues.at(-1) ?? null;

  return facts;
}
