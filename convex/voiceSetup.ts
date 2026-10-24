/**
 * One-off Cartesia setup: registers the record_statement webhook tool and attaches it to the
 * Managed Agent. Internal, so only a developer can run it (never the browser):
 *
 *   npx convex run voiceSetup:registerVoiceTool '{"dryRun": true}'   # no network calls
 *   npx convex run voiceSetup:registerVoiceTool                       # live
 *
 * The webhook URL is this deployment's CONVEX_SITE_URL (must be HTTPS: a cloud deployment).
 * VOICE_TOOL_SECRET is sent to Cartesia as a write-only secret and never returned.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { CartesiaClient, buildRecordStatementTool, ensureRecordStatementTool, redactToolDefinition, type EnsureToolResult, type WebhookToolDefinition } from "../lib/providers/cartesia";
import { redact } from "../lib/providers/errors";

export const RECORD_STATEMENT_PATH = "/voice/tools/record-statement";

type Result =
  | { ok: true; dryRun: true; agentId: string | null; tool: WebhookToolDefinition }
  | ({ ok: true; dryRun: false } & EnsureToolResult)
  | { ok: false; error: string };

export const registerVoiceTool = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (_ctx, { dryRun }): Promise<Result> => {
    try {
      const site = process.env.CONVEX_SITE_URL;
      if (!site) return { ok: false, error: "CONVEX_SITE_URL is not available in this deployment" };
      const endpointUrl = `${site.replace(/\/$/, "")}${RECORD_STATEMENT_PATH}`;
      const toolSecret = process.env.VOICE_TOOL_SECRET ?? "";
      if (dryRun) {
        return { ok: true, dryRun: true, agentId: process.env.CARTESIA_AGENT_ID ?? null, tool: redactToolDefinition(buildRecordStatementTool(endpointUrl, toolSecret)) };
      }
      const client = new CartesiaClient(process.env.CARTESIA_API_KEY ?? "");
      const r = await ensureRecordStatementTool(client, { agentId: process.env.CARTESIA_AGENT_ID ?? "", endpointUrl, toolSecret });
      return { ok: true, dryRun: false, ...r };
    } catch (e) {
      return { ok: false, error: redact(e instanceof Error ? e.message : String(e)) };
    }
  },
});
