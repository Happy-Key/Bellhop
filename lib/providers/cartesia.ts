/**
 * Cartesia Managed Agents admin client: registers our webhook tool and attaches it to the agent.
 * Docs (verified 2026-10-23, not yet run live):
 *  - POST /v1/agents/tools, PATCH /v1/agents/tools/{id}, GET /v1/agents/tools?type=webhook
 *    https://docs.cartesia.ai/api-reference/agents/tools/create.md
 *  - GET / PATCH /v1/agents/{agent_id}. `config.tools` is [{id}] and an update REPLACES the
 *    whole list, so we merge with what is already attached.
 *    https://docs.cartesia.ai/api-reference/agents/update.md
 *  - Errors (2026-03-01+): { title, message, error_code?, request_id }.
 *    https://docs.cartesia.ai/use-the-api/api-errors
 */
import { z } from "zod";
import { ProviderError, redact, type FetchLike } from "./errors";

export const CARTESIA_BASE_URL = "https://api.cartesia.ai";
export const CARTESIA_VERSION = "2026-08-14";
export const RECORD_STATEMENT_TOOL_NAME = "record_statement";
/**
 * Cartesia system variable holding the call ID (https://docs.cartesia.ai/agents/dynamic-variables.md).
 * Browser access tokens cannot supply custom dynamic variables (`dynamic_variables_not_allowed`,
 * seen live 2026-10-24), so the case is found by the call ID the browser bound to its session.
 */
export const CALL_ID_VARIABLE = "system__conversation_id";
const MAX_TOOL_PAGES = 20;

const ToolSummary = z.object({ id: z.string().min(1), name: z.string(), type: z.string() }).loose();
const ToolList = z.object({ data: z.array(ToolSummary), has_more: z.boolean(), next_page: z.string().nullish() }).loose();
const AgentResponse = z
  .object({ id: z.string(), config: z.object({ tools: z.array(z.object({ id: z.string().min(1) }).loose()).nullish() }).loose() })
  .loose();
const ErrorBody = z.object({ title: z.string().optional(), message: z.string().optional(), error_code: z.string().nullish(), request_id: z.string().optional() }).loose();

export interface WebhookToolDefinition {
  type: "webhook";
  name: string;
  description: string;
  pre_tool_speech: "auto" | "force" | "off";
  execution_mode: "immediate" | "async";
  response_timeout_secs: number;
  api_schema: Record<string, unknown>;
}

/**
 * The tool Cartesia calls after each customer statement. The model supplies only the
 * utterance; the call ID comes from a system variable, so the model never sees or chooses
 * which case it writes to.
 */
export function buildRecordStatementTool(endpointUrl: string, toolSecret: string): WebhookToolDefinition {
  if (!/^https:\/\//.test(endpointUrl)) throw new ProviderError("cartesia", "not_configured", `webhook URL must be public HTTPS (got ${endpointUrl}); use a cloud Convex deployment`);
  if (!toolSecret) throw new ProviderError("cartesia", "not_configured", "VOICE_TOOL_SECRET not set");
  return {
    type: "webhook",
    name: RECORD_STATEMENT_TOOL_NAME,
    description:
      "Records what the customer just said about their disputed payment in the case file and returns what to say next. " +
      "Call it after every complete customer statement about the claim, including short answers and corrections. " +
      "Before calling it, tell the customer you are working on it and they should wait, for example \"Okay, understood. Give me a moment while I go through the details.\" " +
      "(after a short yes or no: \"Okay, one moment.\"). Never say \"I'll note that\". " +
      "Then say the returned `question`, in your own natural words, and nothing else. " +
      "If `end_call` is true, `question` is the closing message: say it, then end the call right away with the end_call tool, without waiting for a reply. " +
      "Pass the `question_id` from the previous result back as `question_id`. Do not draw your own conclusions about the case.",
    // "force": the agent always speaks before the call, so the customer knows to wait (live 2026-10-24: silence after "I'll note that").
    pre_tool_speech: "force",
    execution_mode: "immediate",
    response_timeout_secs: 20,
    api_schema: {
      url: endpointUrl,
      method: "POST",
      request_body_schema: {
        type: "object",
        properties: {
          utterance: { type: "string", description: "The customer's latest complete statement, in their own words. Do not summarize, interpret, or add anything." },
          question_id: { type: "string", description: "The question_id from the previous record_statement result, exactly as returned. Omit it on the first call or if the previous result had none." },
          call_id: { type: "string", dynamic_variable: CALL_ID_VARIABLE },
        },
        required: ["utterance"],
      },
      authentication: { mode: "bearer", token: { type: "secret", secret_description: "VOICE_TOOL_SECRET", secret_value: toolSecret } },
    },
  };
}

/** Copy of a definition that is safe to log or return (secret removed). */
export function redactToolDefinition(def: WebhookToolDefinition): WebhookToolDefinition {
  const auth = def.api_schema.authentication as { mode: string; token: Record<string, unknown> } | undefined;
  if (!auth) return def;
  return { ...def, api_schema: { ...def.api_schema, authentication: { ...auth, token: { ...auth.token, secret_value: "[REDACTED]" } } } };
}

export class CartesiaClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = CARTESIA_BASE_URL,
  ) {
    if (!apiKey) throw new ProviderError("cartesia", "not_configured", "CARTESIA_API_KEY not set");
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Cartesia-Version": CARTESIA_VERSION, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ProviderError("cartesia", "network", redact(String(e)));
    }
    if (!res.ok) throw new ProviderError("cartesia", "http", `${method} ${path.split("?")[0]} HTTP ${res.status}: ${await errorDetail(res, this.apiKey)}`, res.status);
    return res.json().catch(() => {
      throw new ProviderError("cartesia", "malformed_response", `${method} ${path.split("?")[0]} returned non-JSON`);
    });
  }

  async findWebhookTools(name: string): Promise<{ id: string; name: string }[]> {
    const found: { id: string; name: string }[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const qs = new URLSearchParams({ type: "webhook", limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
      const parsed = ToolList.safeParse(await this.request("GET", `/v1/agents/tools?${qs}`));
      if (!parsed.success) throw new ProviderError("cartesia", "malformed_response", "tool list missing data/has_more");
      found.push(...parsed.data.data.filter((t) => t.name === name).map((t) => ({ id: t.id, name: t.name })));
      cursor = parsed.data.next_page ?? parsed.data.data.at(-1)?.id;
      if (!parsed.data.has_more || !cursor) return found;
    }
    throw new ProviderError("cartesia", "malformed_response", `tool list exceeded ${MAX_TOOL_PAGES} pages`);
  }

  async createTool(def: WebhookToolDefinition): Promise<string> {
    return toolId(await this.request("POST", "/v1/agents/tools", def));
  }

  async updateTool(id: string, def: WebhookToolDefinition): Promise<string> {
    const patch: Partial<WebhookToolDefinition> = { ...def };
    delete patch.type; // the discriminator; not changed on update
    return toolId(await this.request("PATCH", `/v1/agents/tools/${encodeURIComponent(id)}`, patch));
  }

  async getAgentToolIds(agentId: string): Promise<string[]> {
    const parsed = AgentResponse.safeParse(await this.request("GET", `/v1/agents/${encodeURIComponent(agentId)}`));
    if (!parsed.success) throw new ProviderError("cartesia", "malformed_response", "agent response missing config");
    return (parsed.data.config.tools ?? []).map((t) => t.id);
  }

  async setAgentToolIds(agentId: string, ids: string[], versionDescription: string): Promise<void> {
    await this.request("PATCH", `/v1/agents/${encodeURIComponent(agentId)}`, { config: { tools: ids.map((id) => ({ id })) }, version_description: versionDescription });
  }
}

function toolId(json: unknown): string {
  const parsed = ToolSummary.safeParse(json);
  if (!parsed.success) throw new ProviderError("cartesia", "malformed_response", "tool response missing id");
  return parsed.data.id;
}

async function errorDetail(res: Response, apiKey: string): Promise<string> {
  const text = (await res.text().catch(() => "")).split(apiKey).join("[REDACTED]");
  try {
    const p = ErrorBody.safeParse(JSON.parse(text));
    if (p.success && (p.data.title || p.data.message)) {
      return redact([p.data.title, p.data.message, p.data.error_code && `code ${p.data.error_code}`, p.data.request_id && `request ${p.data.request_id}`].filter(Boolean).join(" | ")).slice(0, 400);
    }
  } catch {
    // not JSON; fall through
  }
  return redact(text).slice(0, 300);
}

export interface EnsureToolResult {
  toolId: string;
  toolAction: "created" | "updated";
  attached: boolean;
  agentToolCount: number;
  duplicateToolIds: string[];
}

/**
 * Idempotent: creates the tool if no webhook tool with our name exists, otherwise updates it
 * (refreshing URL and secret), then makes sure the agent references it. Re-running is safe.
 */
export async function ensureRecordStatementTool(
  client: CartesiaClient,
  opts: { agentId: string; endpointUrl: string; toolSecret: string },
): Promise<EnsureToolResult> {
  if (!opts.agentId) throw new ProviderError("cartesia", "not_configured", "CARTESIA_AGENT_ID not set");
  const def = buildRecordStatementTool(opts.endpointUrl, opts.toolSecret);
  const existing = await client.findWebhookTools(def.name);
  const current = await client.getAgentToolIds(opts.agentId);
  // Prefer a same-named tool that is already attached, so re-runs don't attach a second copy.
  const chosen = existing.find((t) => current.includes(t.id)) ?? existing[0];
  const id = chosen ? await client.updateTool(chosen.id, def) : await client.createTool(def);
  const attached = !current.includes(id);
  if (attached) await client.setAgentToolIds(opts.agentId, [...current, id], `Attach ${def.name} webhook tool`);
  return {
    toolId: id,
    toolAction: chosen ? "updated" : "created",
    attached,
    agentToolCount: attached ? current.length + 1 : current.length,
    duplicateToolIds: existing.filter((t) => t.id !== id).map((t) => t.id),
  };
}
