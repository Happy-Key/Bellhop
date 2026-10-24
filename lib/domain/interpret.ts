/**
 * SCRIPTED (deterministic) statement interpretation.
 *
 * This is pattern matching, not model reasoning, and every result it produces is
 * labelled mode: "scripted". It exists so the workflow is usable and testable before a
 * live reasoning provider is verified. It is never used as a silent fallback when a
 * live call fails.
 *
 * Statement text is treated as evidence only: nothing in it can change application
 * policy, select an account, or trigger an action.
 */
import type { AuthorizationClaim, CredentialSharing, StatementInterpretation } from "./schemas";

export const SCRIPTED_PROVIDER = "scripted-pattern-extractor@1";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function extractAmounts(text: string): number[] {
  const found: number[] = [];
  const re = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)|\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s?(?:dollars|usd)\b/gi;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? "").replace(/,/g, "");
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && !found.includes(n)) found.push(n);
  }
  return found.slice(0, 10);
}

/** Dates are resolved relative to when the statement was received (UTC). */
export function extractDates(text: string, receivedAt: number): string[] {
  const out = new Set<string>();
  const ref = new Date(receivedAt);
  const refYear = ref.getUTCFullYear();

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const d = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) out.add(d);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    let y = m[3] ? Number(m[3]) : refYear;
    if (y < 100) y += 2000;
    const d = isoDate(y, Number(m[1]), Number(m[2]));
    if (d) out.add(d);
  }
  const monthNames = Object.keys(MONTHS).join("|");
  const re = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");
  for (const m of text.matchAll(re)) {
    const month = MONTHS[(m[1] ?? "").toLowerCase()];
    if (!month) continue;
    let y = m[3] ? Number(m[3]) : refYear;
    // A month/day with no year that lies in the future is assumed to be last year.
    if (!m[3] && Date.UTC(y, month - 1, Number(m[2])) > receivedAt) y -= 1;
    const d = isoDate(y, month, Number(m[2]));
    if (d) out.add(d);
  }
  const dayMs = 86_400_000;
  const relative: Array<[RegExp, number]> = [
    [/\byesterday\b/i, -1],
    [/\btoday\b/i, 0],
    [/\bday before yesterday\b/i, -2],
  ];
  for (const [re2, offset] of relative) {
    if (re2.test(text)) {
      const t = new Date(receivedAt + offset * dayMs);
      out.add(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`);
    }
  }
  return [...out].slice(0, 10);
}

const STOPWORDS = new Set(["the", "my", "a", "an", "this", "that", "some", "your", "our", "their", "me", "it"]);

/** Capitalized phrases after at/from/to/with/on — candidate merchant names, verified later against records. */
export function extractMerchantTerms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:at|from|to|with|on|by)\s+((?:[A-Z][\w'&.-]*)(?:\s+[A-Z][\w'&.-]*){0,3})/g)) {
    const term = (m[1] ?? "").trim().replace(/[.,]$/, "");
    const first = term.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (term.length >= 3 && !STOPWORDS.has(first) && !(first in MONTHS) && !out.includes(term)) out.push(term);
  }
  return out.slice(0, 10);
}

const DENIAL = [
  /\b(?:did ?n[o']?t|never|didnt)\s+(?:make|authori[sz]e|approve|recogni[sz]e|do|buy|purchase|send)\b/i,
  /\bnot\s+(?:me|mine|authori[sz]ed)\b/i,
  /\bunauthori[sz]ed\b/i,
  /\bdon'?t\s+recogni[sz]e\b/i,
  /\b(?:stolen|someone\s+(?:else\s+)?used)\b/i,
];
const SELF_INITIATED = [
  /\bI\s+(?:sent|paid|transferred|wired|made|authori[sz]ed|approved)\b/i,
];
const INDUCEMENT = [
  /\b(?:scam(?:med)?|tricked|deceived|fraudster|impersonat\w*|pretend(?:ed|ing) to be|posing as)\b/i,
  /\b(?:told|asked|instructed)\s+me\s+to\b/i,
];
const CREDENTIAL_SHARED = [
  /\b(?:gave|shared|told|read)\s+(?:them|him|her|the caller|someone)?\s*(?:my|the)\s+(?:codes?|passwords?|pin|otp|one[- ]time|login|card number|verification)\b/i,
];
const CREDENTIAL_NOT_SHARED = [
  /\b(?:never|did ?n[o']?t|didnt)\s+(?:share|shared|give|gave|given|tell|told)\b[^.]*\b(?:codes?|passwords?|pin|card|login)\b/i,
];

function anyMatch(patterns: RegExp[], text: string): string[] {
  return patterns.flatMap((p) => {
    const m = text.match(p);
    return m ? [m[0]] : [];
  });
}

export function classifyAuthorization(text: string): { authorization: AuthorizationClaim; scamIndicators: string[] } {
  const denial = anyMatch(DENIAL, text);
  const self = anyMatch(SELF_INITIATED, text);
  const induced = anyMatch(INDUCEMENT, text);
  if (self.length && induced.length) return { authorization: "authorized_induced", scamIndicators: induced };
  if (denial.length) return { authorization: "denies_authorization", scamIndicators: induced };
  if (self.length) return { authorization: "authorized", scamIndicators: induced };
  return { authorization: "unspecified", scamIndicators: induced };
}

export function classifyCredentialSharing(text: string): CredentialSharing {
  if (anyMatch(CREDENTIAL_NOT_SHARED, text).length) return "not_shared";
  if (anyMatch(CREDENTIAL_SHARED, text).length) return "shared";
  return "unspecified";
}

/** Heuristic: statements starting with "correction" / "actually" / "sorry, I meant" are corrections. */
export function looksLikeCorrection(text: string): boolean {
  return /^\s*(?:correction\b|actually\b|sorry,?\s+(?:i|it)\s+(?:meant|was)|i\s+meant\b|let me correct)/i.test(text);
}

export function interpretStatementScripted(text: string, receivedAt: number): StatementInterpretation {
  const { authorization, scamIndicators } = classifyAuthorization(text);
  return {
    mode: "scripted",
    provider: SCRIPTED_PROVIDER,
    amounts: extractAmounts(text),
    dates: extractDates(text, receivedAt),
    merchantTerms: extractMerchantTerms(text),
    authorization,
    credentialSharing: classifyCredentialSharing(text),
    scamIndicators,
  };
}
