/**
 * CRS Credit API sandbox client (TransUnion basic identity verification).
 * Docs: https://calhacks.crscreditapi.com and the CRS MCP package guides
 * (tu_identity_verification.md, auth-info).
 *
 * Verified 2026-10-23:
 *  - POST {base}/users/login {username,password} -> { token, expires, refreshToken }.
 *  - Repeated failed logins disable the account (CRS113/CRS114): callers must not retry
 *    a failed login automatically.
 *  - POST {base}/transunion/identity-manager-verification/basic (flat camelCase body).
 *    Result: addOnProducts[0].idManagerVerification.messages[] — empty = verified.
 *  - Errors: { timestamp, codes, messages, details }. 401 = bad token or product not enabled.
 */
import { z } from "zod";
import { CRS_PERSONA_SSN, type CrsPersona } from "../fixtures/crsPersonas";
import type { ProviderEvidence } from "../domain/schemas";
import { ProviderError, redact, type FetchLike } from "./errors";

export const CRS_DEFAULT_BASE_URL = "https://api-sandbox.stitchcredit.com:443/api";
import { FRAUD_FINDER_PRODUCT, IDENTITY_PRODUCT } from "../domain/fraudSignals";
export { IDENTITY_PRODUCT };
/** Used when the login response's `expires` cannot be interpreted. */
const FALLBACK_TOKEN_TTL_MS = 30 * 60 * 1000;

const LoginResponse = z.object({ token: z.string().min(1), expires: z.unknown().optional() }).loose();

const CrsMessage = z.object({ code: z.union([z.string(), z.number()]).transform(String), text: z.string().nullish() }).loose();
export const IdentityResponse = z
  .object({
    addOnProducts: z
      .array(z.object({ idManagerVerification: z.object({ messages: z.array(CrsMessage).nullish() }).loose() }).loose())
      .min(1),
  })
  .loose();

const CrsErrorBody = z.object({ codes: z.array(z.string()).optional(), messages: z.array(z.string()).optional() }).loose();

export interface CrsToken {
  token: string;
  expiresAt: number;
}

export interface IdentityCheckResult {
  personaId: string;
  requestId: string | null;
  messages: { code: string; text: string }[];
}

/** Interprets `expires` (epoch seconds/ms or ISO string) into an absolute time. */
export function tokenExpiry(expires: unknown, now: number): number {
  if (typeof expires === "number" && Number.isFinite(expires)) {
    if (expires > 1e12) return expires; // epoch ms
    if (expires > 1e9) return expires * 1000; // epoch seconds
    return now + expires * 1000; // duration in seconds
  }
  if (typeof expires === "string") {
    const t = Date.parse(expires);
    if (Number.isFinite(t)) return t;
  }
  return now + FALLBACK_TOKEN_TTL_MS;
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = CrsErrorBody.safeParse(JSON.parse(text));
    if (parsed.success && (parsed.data.codes || parsed.data.messages)) {
      return [parsed.data.codes?.join(","), parsed.data.messages?.join("; ")].filter(Boolean).join(": ");
    }
  } catch {
    // not JSON; fall through
  }
  return redact(text).slice(0, 200);
}

export async function crsLogin(baseUrl: string, username: string, password: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<CrsToken> {
  if (!username || !password) throw new ProviderError("crs", "not_configured", "CRS_USERNAME / CRS_PASSWORD not set");
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new ProviderError("crs", "network", redact(String(e)));
  }
  if (!res.ok) throw new ProviderError("crs", "http", `login HTTP ${res.status}: ${(await errorDetail(res)).split(password).join("[REDACTED]")}`, res.status);
  const parsed = LoginResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ProviderError("crs", "malformed_response", "login response missing token");
  return { token: parsed.data.token, expiresAt: tokenExpiry(parsed.data.expires, now) };
}

export async function verifyIdentity(baseUrl: string, token: string, persona: CrsPersona, fetchImpl: FetchLike = fetch): Promise<IdentityCheckResult> {
  // Billing guard: only CRS-published persona bodies are ever sent.
  if (!CRS_PERSONA_SSN.test(persona.identityBody.ssn)) throw new ProviderError("crs", "rejected_output", "refusing to send a non-persona identity");
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/transunion/identity-manager-verification/basic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(persona.identityBody),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ProviderError("crs", "network", redact(String(e)));
  }
  if (!res.ok) throw new ProviderError("crs", "http", `identity verification HTTP ${res.status}: ${await errorDetail(res)}`, res.status);
  const parsed = IdentityResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ProviderError("crs", "malformed_response", "missing addOnProducts[0].idManagerVerification");
  const messages = (parsed.data.addOnProducts[0]!.idManagerVerification.messages ?? []).map((m) => ({ code: m.code, text: m.text ?? "" }));
  return { personaId: persona.id, requestId: res.headers.get("RequestID") ?? res.headers.get("requestid"), messages };
}

/**
 * Fraud Finder (AtData email risk). Guide: package dist/guides/fraud_finder.md (re-read 2026-10-24).
 *  - POST {base}/fraud-finder/fraud-finder (config "fraud-finder"); `email` required.
 *  - risk.score 0-100, higher is riskier; CRS's PDF bands: <=30 low, <=60 medium, else high.
 *  - It scores the claimant's contact details, not the disputed payment.
 */
export { FRAUD_FINDER_PRODUCT, FRAUD_RISK_BANDS, fraudRiskBand } from "../domain/fraudSignals";

export const FraudFinderResponse = z
  .object({
    risk: z.object({ score: z.number().min(0).max(100), tumbling_risk: z.number().nullish() }).loose(),
    email_validation: z.object({ status: z.string().nullish() }).loose().nullish(),
  })
  .loose();

export interface FraudFinderResult {
  personaId: string;
  requestId: string | null;
  score: number;
  emailStatus: string | null;
}

export async function fraudFinderCheck(baseUrl: string, token: string, persona: CrsPersona, fetchImpl: FetchLike = fetch): Promise<FraudFinderResult> {
  // Billing guard: only the persona's published body (sandbox addresses end in @example.com).
  if (!CRS_PERSONA_SSN.test(persona.identityBody.ssn) || !persona.fraudFinderBody.email.endsWith("@example.com")) {
    throw new ProviderError("crs", "rejected_output", "refusing to send a non-persona Fraud Finder request");
  }
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/fraud-finder/fraud-finder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(persona.fraudFinderBody),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new ProviderError("crs", "network", redact(String(e)));
  }
  if (!res.ok) throw new ProviderError("crs", "http", `Fraud Finder HTTP ${res.status}: ${await errorDetail(res)}`, res.status);
  const parsed = FraudFinderResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ProviderError("crs", "malformed_response", "missing risk.score");
  return {
    personaId: persona.id,
    requestId: res.headers.get("RequestID") ?? res.headers.get("requestid"),
    score: parsed.data.risk.score,
    emailStatus: parsed.data.email_validation?.status ?? null,
  };
}

/** Fraud Finder result as provider facts. Refs never end in ":result", which marks identity checks. */
export function fraudFinderEvidence(result: FraudFinderResult, checkKey: string): ProviderEvidence[] {
  const base = `X:crs:${result.personaId}:${checkKey}`;
  const rows: ProviderEvidence[] = [
    { ref: `${base}:ff-score`, provider: "crs", product: FRAUD_FINDER_PRODUCT, field: "risk_score", value: String(result.score), syntheticAssociation: true },
  ];
  if (result.emailStatus) rows.push({ ref: `${base}:ff-email`, provider: "crs", product: FRAUD_FINDER_PRODUCT, field: "email_status", value: result.emailStatus.slice(0, 40), syntheticAssociation: true });
  return rows;
}

/** Normalizes an identity check into provider facts. Facts only: no conclusions about the claim. */
export function identityEvidence(result: IdentityCheckResult, checkKey: string): ProviderEvidence[] {
  const base = `X:crs:${result.personaId}:${checkKey}`;
  const rows: ProviderEvidence[] = [
    {
      ref: `${base}:result`,
      provider: "crs",
      product: IDENTITY_PRODUCT,
      field: "verification_messages",
      value: result.messages.length === 0 ? "none returned (identity elements verified)" : `${result.messages.length} message(s) returned`,
      syntheticAssociation: true,
    },
  ];
  result.messages.forEach((m, i) =>
    rows.push({
      ref: `${base}:msg${i + 1}`,
      provider: "crs",
      product: IDENTITY_PRODUCT,
      field: `message_${m.code}`,
      value: m.text.slice(0, 300),
      syntheticAssociation: true,
    }),
  );
  return rows;
}
