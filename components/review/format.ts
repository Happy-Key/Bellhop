/** Display helpers for the claims workstation. Formatting only; no case logic. */

/** Short, stable display reference derived from the Convex document ID. */
export const caseRef = (id: string) => `FC-${id.slice(-6).toUpperCase()}`;

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Precise timestamp with time zone: a report may be notice to the bank, so its time matters. */
export const exactTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

export const shortTime = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return shortTime(ms);
}

export const humanize = (s: string) => s.replace(/_/g, " ");

/** Long provider IDs (Nessie UUIDs) shortened for display; the full ref stays in titles and labels. */
export function shortRef(ref: string): string {
  // Provider facts: X:<provider>:<subject>:<uuid>:<field> → X:<provider>·<subject>·<field>
  const x = ref.match(/^X:([^:]+):([^:]+):[^:]+:(.+)$/);
  if (x) return `X:${x[1]}·${x[2]}·${x[3]}`;
  const m = ref.match(/^(T:)(.+)$/);
  if (!m || ref.length <= 14) return ref;
  return `${m[1]}${m[2]!.slice(0, 4)}…${m[2]!.slice(-4)}`;
}

/** A question key with any long transaction refs shortened (the full key stays in the title). */
export const shortKey = (key: string) => key.replace(/T:[A-Za-z0-9_-]+/g, shortRef);

/** Fact field names as stored in the analysis, in reviewer language. */
export const FIELD_LABEL: Record<string, string> = {
  amounts: "amount",
  dates: "date",
  merchantTerms: "payee",
  authorization: "who sent it",
  credentialSharing: "codes shared",
};

/** Customer position as reported (never a legal classification). */
export const POSITION_LABEL: Record<string, string> = {
  denies_authorization: "Says they did not make the payment",
  authorized_induced: "Says they sent it after being deceived",
  authorized: "Says they sent it themselves",
  unspecified: "Not stated",
};

export const CREDENTIALS_LABEL: Record<string, string> = {
  shared: "Says codes or details were shared",
  not_shared: "Says nothing was shared",
  unspecified: "Not stated",
};
