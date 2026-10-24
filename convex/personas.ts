/**
 * SYNTHETIC demo personas (lib/fixtures/demoPersonas.ts): a demo aid, not a product feature.
 *
 * The client names a persona, never an account: the backend maps the persona to its Nessie account
 * through the NESSIE_PERSONA_ACCOUNTS env var (JSON, persona id -> account id, written by
 * `npm run seed:personas`). A persona case links its CRS test identity at creation and then sets
 * itself up (convex/personaSetup.ts). With no persona, /call keeps creating plain synthetic cases
 * with no automatic setup.
 */
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { currentEvidence, logActivity, recomputeAnalysis } from "./model";
import { getDemoPersona, personaLabel, personaPurchaseFor } from "../lib/fixtures/demoPersonas";

/** The persona's Nessie account from backend configuration, or null when it isn't configured. */
export function personaAccountId(personaId: string): string | null {
  const raw = process.env.NESSIE_PERSONA_ACCOUNTS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    const id = map[personaId];
    return typeof id === "string" && id ? id : null;
  } catch {
    throw new Error("NESSIE_PERSONA_ACCOUNTS is not valid JSON");
  }
}

export const createForPersona = mutation({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }) => createPersonaCase(ctx, personaId),
});

/** Opens a case for a demo persona and schedules its setup (also used by the claim suite runner, convex/suite.ts). */
export async function createPersonaCase(ctx: MutationCtx, personaId: string): Promise<Id<"cases">> {
  const persona = getDemoPersona(personaId);
  if (!persona) throw new Error(`unknown demo persona ${personaId}`);
  const accountId = personaAccountId(persona.id);
  if (!accountId) throw new Error(`demo persona ${persona.id} has no Nessie account configured (run npm run seed:personas, then set NESSIE_PERSONA_ACCOUNTS)`);
  const now = Date.now();
  const caseId = await ctx.db.insert("cases", {
    title: `Demo persona ${persona.name} ${new Date(now).toISOString().slice(0, 16).replace("T", " ")}Z`,
    synthetic: true,
    customerLabel: personaLabel(persona),
    nessieAccountId: accountId,
    crsPersonaId: persona.crsPersonaId,
    demoPersonaId: persona.id,
    nextStatementNumber: 1,
    bankFetch: { status: "never" },
    analysis: null,
    analysisVersion: 0,
    createdAt: now,
  });
  await logActivity(
    ctx,
    caseId,
    `persona:${persona.id}`,
    "case_created",
    `Synthetic case created for SYNTHETIC demo persona ${persona.name}: Nessie account bound by backend configuration; CRS test persona ${persona.crsPersonaId} linked (SYNTHETIC association). Expected outcome: ${persona.expectedOutcome}`,
  );
  await recomputeAnalysis(ctx, caseId);
  await ctx.scheduler.runAfter(0, internal.personaSetup.setUpCase, { caseId });
  return caseId;
}

/**
 * Attaches the persona's SYNTHETIC payment-origin records to the case's retrieved transactions.
 * Runs after every retrieval on a persona case. A record already set (e.g. changed by a reviewer on
 * the case page) is left alone.
 */
export async function applyPersonaOrigins(ctx: MutationCtx, caseId: Id<"cases">): Promise<number> {
  const c = await ctx.db.get(caseId);
  const persona = getDemoPersona(c?.demoPersonaId);
  if (!persona) return 0;
  const { transactions } = await currentEvidence(ctx, caseId);
  const attached: string[] = [];
  for (const t of transactions) {
    if (t.kind === "deposit") continue;
    const purchase = personaPurchaseFor(persona, t);
    if (!purchase) continue;
    const existing = await ctx.db.query("paymentOrigins").withIndex("by_txn", (q) => q.eq("txnExternalId", t.externalId)).unique();
    if (existing) continue;
    await ctx.db.insert("paymentOrigins", { txnExternalId: t.externalId, ...purchase.origin, synthetic: true, preset: `persona:${persona.id}:${purchase.key}`, setAt: Date.now() });
    attached.push(`${t.ref} (${purchase.key})`);
  }
  if (attached.length) {
    await logActivity(ctx, caseId, `persona:${persona.id}`, "payment_origin_set", `SYNTHETIC payment-origin records attached from demo persona ${persona.name}: ${attached.join(", ")}.`);
  }
  return attached.length;
}

export const logSetup = internalMutation({
  args: { caseId: v.id("cases"), kind: v.string(), message: v.string() },
  handler: async (ctx, { caseId, kind, message }) => {
    const c = await ctx.db.get(caseId);
    await logActivity(ctx, caseId, `persona:${c?.demoPersonaId ?? "?"}`, kind, message);
  },
});
