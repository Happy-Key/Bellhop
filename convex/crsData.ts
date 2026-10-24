/**
 * CRS persistence: persona linking, token cache with login lock, and evidence storage.
 * The CRS network calls live in convex/crs.ts (Node action).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { logActivity, recomputeAnalysis } from "./model";
import { getCrsPersona } from "../lib/fixtures/crsPersonas";

/** Reviewer links a CRS test persona to a case. Only published personas are accepted. */
export const linkPersona = mutation({
  args: { caseId: v.id("cases"), personaId: v.string() },
  handler: async (ctx, { caseId, personaId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) throw new Error("case not found");
    const persona = getCrsPersona(personaId);
    if (!persona) throw new Error(`unknown CRS test persona ${personaId}`);
    if (c.crsPersonaId === persona.id) return;
    // Evidence about a previously linked persona no longer describes this case's subject.
    let removed = 0;
    const existing = await ctx.db.query("providerEvidence").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    for (const e of existing) {
      if (e.provider === "crs") {
        await ctx.db.delete(e._id);
        removed++;
      }
    }
    await ctx.db.patch(caseId, { crsPersonaId: persona.id });
    await logActivity(
      ctx,
      caseId,
      "human",
      "crs_persona_linked",
      `CRS test persona ${persona.id} linked${c.crsPersonaId ? ` (replacing ${c.crsPersonaId}; ${removed} earlier CRS evidence row(s) removed)` : ""}. SYNTHETIC association: CRS identities and Nessie customers are separate datasets.`,
    );
    await recomputeAnalysis(ctx, caseId);
  },
});

export const getCaseForCrs = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    return c ? { crsPersonaId: c.crsPersonaId ?? null } : null;
  },
});

export const getAuth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const a = await ctx.db.query("providerAuth").withIndex("by_provider", (q) => q.eq("provider", "crs")).unique();
    return a ? { token: a.token ?? null, expiresAt: a.expiresAt ?? 0, loginLockedAt: a.loginLockedAt ?? null, loginLockReason: a.loginLockReason ?? null } : null;
  },
});

async function upsertAuth(
  ctx: MutationCtx,
  patch: { token?: string; expiresAt?: number; loginLockedAt?: number; loginLockReason?: string },
) {
  const a = await ctx.db.query("providerAuth").withIndex("by_provider", (q) => q.eq("provider", "crs")).unique();
  if (a) await ctx.db.patch(a._id, patch);
  else await ctx.db.insert("providerAuth", { provider: "crs", ...patch });
}

export const saveToken = internalMutation({
  args: { token: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => upsertAuth(ctx, { token: args.token, expiresAt: args.expiresAt }),
});

/** Drop a token the API rejected (401). Does not lock: the next call may log in once. */
export const clearToken = internalMutation({
  args: {},
  handler: async (ctx) => upsertAuth(ctx, { token: undefined, expiresAt: undefined }),
});

export const lockLogin = internalMutation({
  args: { reason: v.string() },
  handler: async (ctx, { reason }) => upsertAuth(ctx, { token: undefined, expiresAt: undefined, loginLockedAt: Date.now(), loginLockReason: reason.slice(0, 300) }),
});

/**
 * Clears the login lock after a human has fixed CRS credentials. Run deliberately:
 *   npx convex run crsData:unlockLogin
 */
export const unlockLogin = internalMutation({
  args: {},
  handler: async (ctx) => upsertAuth(ctx, { loginLockedAt: undefined, loginLockReason: undefined }),
});

export const storeIdentityEvidence = internalMutation({
  args: {
    caseId: v.id("cases"),
    personaId: v.string(),
    rows: v.array(v.object({ ref: v.string(), provider: v.string(), product: v.string(), field: v.string(), value: v.string(), syntheticAssociation: v.boolean() })),
  },
  handler: async (ctx, { caseId, personaId, rows }) => {
    const now = Date.now();
    // Replace earlier results for the same persona so one check is shown at a time.
    const existing = await ctx.db.query("providerEvidence").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    for (const e of existing) if (e.provider === "crs" && e.ref.startsWith(`X:crs:${personaId}:`)) await ctx.db.delete(e._id);
    for (const r of rows) await ctx.db.insert("providerEvidence", { caseId, retrievedAt: now, ...r });
    await logActivity(ctx, caseId, "crs:live", "identity_evidence_retrieved", `LIVE CRS sandbox identity check for test persona ${personaId}: ${rows[0]?.value ?? "no result"}.`);
    await recomputeAnalysis(ctx, caseId);
  },
});

export const recordCrsError = internalMutation({
  args: { caseId: v.id("cases"), error: v.string() },
  handler: async (ctx, { caseId, error }) => {
    await logActivity(ctx, caseId, "crs:live", "integration_error", `CRS identity check FAILED: ${error}. No fixture data substituted.`);
  },
});
