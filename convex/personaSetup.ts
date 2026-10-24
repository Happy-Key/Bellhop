"use node";
/**
 * Automatic setup for a SYNTHETIC demo-persona case (decided 2026-10-24): retrieve its Nessie
 * records (payment origins attach on storage), then run the CRS identity check and Fraud Finder on
 * its linked test identity. The same live calls as the case-page buttons, one each. Plain cases
 * opened with no persona never run this.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { retrieveBankEvidenceForCase } from "./nessie";
import { retrieveFraudRiskForCase, retrieveIdentityEvidenceForCase } from "./crs";

export const setUpCase = internalAction({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const log = (kind: string, message: string) => ctx.runMutation(internal.personas.logSetup, { caseId, kind, message });
    await log("persona_setup_started", "Demo persona setup started: retrieving bank records, then running CRS checks.");
    const bank = await retrieveBankEvidenceForCase(ctx, caseId);
    // Sequential, so the two CRS checks share one login.
    const identity = await retrieveIdentityEvidenceForCase(ctx, caseId);
    const fraud = await retrieveFraudRiskForCase(ctx, caseId);
    const steps = [
      ["bank records", bank.ok ? `${bank.count ?? 0} record(s)` : `FAILED (${bank.error})`],
      ["CRS identity check", identity.ok ? "done" : `FAILED (${identity.error})`],
      ["CRS Fraud Finder", fraud.ok ? "done" : `FAILED (${fraud.error})`],
    ];
    const ok = bank.ok && identity.ok && fraud.ok;
    await log(ok ? "persona_setup_done" : "integration_error", `Demo persona setup ${ok ? "finished" : "incomplete"}: ${steps.map(([s, r]) => `${s} ${r}`).join("; ")}.`);
  },
});
