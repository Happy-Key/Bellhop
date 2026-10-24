"use node";
/**
 * Live CRS sandbox identity check for the case's linked TEST persona.
 * - Request body comes only from the published persona fixture (never client/model input).
 * - Logs in at most once per token lifetime; any failed login locks further logins until
 *   a human runs `npx convex run crsData:unlockLogin`.
 * - A 401 on a cached token clears it and logs in once more (not a loop).
 */
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { crsLogin, fraudFinderCheck, fraudFinderEvidence, identityEvidence, verifyIdentity, CRS_DEFAULT_BASE_URL } from "../lib/providers/crs";
import { ProviderError, redact } from "../lib/providers/errors";
import { getCrsPersona } from "../lib/fixtures/crsPersonas";

const TOKEN_SAFETY_MS = 60_000;

export type CrsCheckResult = { ok: boolean; error?: string };

async function getToken(ctx: ActionCtx, base: string): Promise<string> {
  const auth = await ctx.runQuery(internal.crsData.getAuth, {});
  if (auth?.loginLockedAt) throw new ProviderError("crs", "not_configured", `CRS login locked after a failed attempt (${auth.loginLockReason ?? "unknown"}). Fix credentials, then run crsData:unlockLogin.`);
  if (auth?.token && auth.expiresAt - TOKEN_SAFETY_MS > Date.now()) return auth.token;
  try {
    const t = await crsLogin(base, process.env.CRS_USERNAME ?? "", process.env.CRS_PASSWORD ?? "");
    await ctx.runMutation(internal.crsData.saveToken, t);
    return t.token;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Lock on any rejected login so we never hammer the account. Missing config doesn't lock.
    if (!(e instanceof ProviderError && e.kind === "not_configured")) await ctx.runMutation(internal.crsData.lockLogin, { reason: redact(msg) });
    throw e;
  }
}

/** Runs `call` with a cached token, logging in again once if the token was rejected (401). */
async function withToken<T>(ctx: ActionCtx, base: string, call: (token: string) => Promise<T>): Promise<T> {
  const token = await getToken(ctx, base);
  try {
    return await call(token);
  } catch (e) {
    if (!(e instanceof ProviderError && e.httpStatus === 401)) throw e;
    // Token may have expired: clear it and log in once more. A second 401 means the product is
    // not enabled for this account, and is reported as an error.
    await ctx.runMutation(internal.crsData.clearToken, {});
    return call(await getToken(ctx, base));
  }
}

/**
 * Live CRS Fraud Finder (AtData email risk) for the case's linked TEST persona. Sends only the
 * persona's published body. It scores the claimant's contact details, not the disputed payment.
 */
export async function retrieveFraudRiskForCase(ctx: ActionCtx, caseId: Id<"cases">): Promise<CrsCheckResult> {
  const c = await ctx.runQuery(internal.crsData.getCaseForCrs, { caseId });
  if (!c) throw new Error("case not found");
  const fail = async (error: string) => {
    await ctx.runMutation(internal.crsData.recordCrsError, { caseId, error: `Fraud Finder: ${error}` });
    return { ok: false, error };
  };
  const persona = c.crsPersonaId ? getCrsPersona(c.crsPersonaId) : undefined;
  if (!persona) return fail("no CRS test persona linked to this case");
  const base = process.env.CRS_BASE_URL || CRS_DEFAULT_BASE_URL;
  try {
    const result = await withToken(ctx, base, (token) => fraudFinderCheck(base, token, persona));
    const checkKey = (result.requestId ?? `${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || `${Date.now()}`;
    await ctx.runMutation(internal.crsData.storeFraudEvidence, { caseId, personaId: persona.id, rows: fraudFinderEvidence(result, checkKey) });
    return { ok: true };
  } catch (e) {
    return fail(redact(e instanceof Error ? e.message : String(e)));
  }
}

export const retrieveFraudRisk = action({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<CrsCheckResult> => retrieveFraudRiskForCase(ctx, caseId),
});

export async function retrieveIdentityEvidenceForCase(ctx: ActionCtx, caseId: Id<"cases">): Promise<CrsCheckResult> {
  const c = await ctx.runQuery(internal.crsData.getCaseForCrs, { caseId });
  if (!c) throw new Error("case not found");
  const fail = async (error: string) => {
    await ctx.runMutation(internal.crsData.recordCrsError, { caseId, error });
    return { ok: false, error };
  };
  const persona = c.crsPersonaId ? getCrsPersona(c.crsPersonaId) : undefined;
  if (!persona) return fail("no CRS test persona linked to this case");
  const base = process.env.CRS_BASE_URL || CRS_DEFAULT_BASE_URL;
  try {
    let token = await getToken(ctx, base);
    let result;
    try {
      result = await verifyIdentity(base, token, persona);
    } catch (e) {
      if (!(e instanceof ProviderError && e.httpStatus === 401)) throw e;
      // Token may have expired: clear it and log in once more. A second 401 means the
      // product is not enabled for this account, and is reported as an error.
      await ctx.runMutation(internal.crsData.clearToken, {});
      token = await getToken(ctx, base);
      result = await verifyIdentity(base, token, persona);
    }
    const checkKey = (result.requestId ?? `${Date.now()}`).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || `${Date.now()}`;
    await ctx.runMutation(internal.crsData.storeIdentityEvidence, { caseId, personaId: persona.id, rows: identityEvidence(result, checkKey) });
    return { ok: true };
  } catch (e) {
    return fail(redact(e instanceof Error ? e.message : String(e)));
  }
}

export const retrieveIdentityEvidence = action({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<CrsCheckResult> => retrieveIdentityEvidenceForCase(ctx, caseId),
});
