import { query } from "./_generated/server";
import { reasoningConfig } from "./model";

/** Integration status for the dashboard. Reports only whether settings exist — never values. */
export const integrationStatus = query({
  args: {},
  handler: async () => {
    const set = (k: string) => !!process.env[k];
    const reasoning = reasoningConfig();
    return {
      nessie: { apiKey: set("NESSIE_API_KEY"), demoAccount: set("NESSIE_DEMO_ACCOUNT_ID"), status: set("NESSIE_API_KEY") && set("NESSIE_DEMO_ACCOUNT_ID") ? "configured" : "needs_configuration" },
      reasoning: {
        mode: reasoning.mode,
        label: reasoning.mode === "live" ? reasoning.label : "scripted-pattern-extractor",
        complete: reasoning.mode === "scripted" || (set("REASONING_BASE_URL") && set("REASONING_API_KEY") && set("REASONING_MODEL")),
      },
      cartesia: {
        apiKey: set("CARTESIA_API_KEY"),
        agentId: set("CARTESIA_AGENT_ID"),
        toolSecret: set("VOICE_TOOL_SECRET"),
        status: set("CARTESIA_API_KEY") && set("CARTESIA_AGENT_ID") && set("VOICE_TOOL_SECRET") ? "configured" : "needs_configuration",
      },
      crs: { credentials: set("CRS_USERNAME") && set("CRS_PASSWORD"), status: set("CRS_USERNAME") && set("CRS_PASSWORD") ? "configured" : "needs_configuration" },
      payout: { status: "simulated: auto-approval policy AUTO-1 (approve-only, up to $100) with Nessie deposits labelled SIMULATED" },
    };
  },
});
