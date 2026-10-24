import { describe, expect, it } from "vitest";
import { CARTESIA_VERSION, CartesiaClient, buildRecordStatementTool, ensureRecordStatementTool, redactToolDefinition } from "@/lib/providers/cartesia";
import type { FetchLike } from "@/lib/providers/errors";

const KEY = "sk_car_testkey123";
const SECRET = "tool-secret-abc";
const AGENT = "agent_test1";
const URL_ = "https://happy-otter-123.convex.site/voice/tools/record-statement";

interface Call { method: string; path: string; headers: Record<string, string>; body: unknown }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Minimal fake of the Cartesia tools + agent API. */
function fakeCartesia(state: { tools: { id: string; name: string }[]; agentTools: string[] }, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: u.pathname + u.search, headers: init?.headers as Record<string, string>, body });
    if (method === "GET" && u.pathname === "/v1/agents/tools") return json(200, { data: state.tools.map((t) => ({ ...t, type: "webhook" })), has_more: false, next_page: null });
    if (method === "POST" && u.pathname === "/v1/agents/tools") {
      state.tools.push({ id: "agent_tool_new", name: body.name });
      return json(201, { id: "agent_tool_new", name: body.name, type: "webhook" });
    }
    const toolMatch = u.pathname.match(/^\/v1\/agents\/tools\/(.+)$/);
    if (method === "PATCH" && toolMatch) return json(200, { id: toolMatch[1], name: "record_statement", type: "webhook" });
    if (u.pathname === `/v1/agents/${AGENT}`) {
      if (method === "PATCH") state.agentTools = body.config.tools.map((t: { id: string }) => t.id);
      return json(200, { id: AGENT, config: { tools: state.agentTools.map((id) => ({ id })) } });
    }
    return json(404, { title: "Not found", message: "no route", request_id: "req_x" });
  };
}

describe("record_statement tool definition", () => {
  it("fills call_id from Cartesia's system variable and only asks the model for the utterance", () => {
    const def = buildRecordStatementTool(URL_, SECRET);
    const body = def.api_schema.request_body_schema as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(def).toMatchObject({ type: "webhook", name: "record_statement", execution_mode: "immediate", api_schema: { url: URL_, method: "POST" } });
    expect(Object.keys(body.properties).sort()).toEqual(["call_id", "utterance"]);
    expect(body.properties.call_id).toEqual({ type: "string", dynamic_variable: "system__conversation_id" });
    expect(body.required).toEqual(["utterance"]);
    expect(def.api_schema.authentication).toEqual({ mode: "bearer", token: { type: "secret", secret_description: "VOICE_TOOL_SECRET", secret_value: SECRET } });
  });

  it("refuses non-HTTPS endpoints and a missing secret", () => {
    expect(() => buildRecordStatementTool("http://127.0.0.1:3211/voice/tools/record-statement", SECRET)).toThrow(/public HTTPS/);
    expect(() => buildRecordStatementTool(URL_, "")).toThrow(/VOICE_TOOL_SECRET/);
  });

  it("redacts the secret for dry runs", () => {
    expect(JSON.stringify(redactToolDefinition(buildRecordStatementTool(URL_, SECRET)))).not.toContain(SECRET);
  });
});

describe("ensureRecordStatementTool (mocked Cartesia)", () => {
  it("creates the tool and attaches it while keeping the agent's existing tools", async () => {
    const state = { tools: [{ id: "agent_tool_other", name: "lookup" }], agentTools: ["agent_tool_other"] };
    const calls: Call[] = [];
    const r = await ensureRecordStatementTool(new CartesiaClient(KEY, fakeCartesia(state, calls)), { agentId: AGENT, endpointUrl: URL_, toolSecret: SECRET });
    expect(r).toEqual({ toolId: "agent_tool_new", toolAction: "created", attached: true, agentToolCount: 2, duplicateToolIds: [] });
    expect(state.agentTools).toEqual(["agent_tool_other", "agent_tool_new"]);
    expect(calls.every((c) => c.headers["Cartesia-Version"] === CARTESIA_VERSION && c.headers.Authorization === `Bearer ${KEY}`)).toBe(true);
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ version_description: "Attach record_statement webhook tool" });
  });

  it("is idempotent: a re-run updates the existing tool and does not re-attach", async () => {
    const state = { tools: [{ id: "agent_tool_rs", name: "record_statement" }], agentTools: ["agent_tool_rs"] };
    const calls: Call[] = [];
    const r = await ensureRecordStatementTool(new CartesiaClient(KEY, fakeCartesia(state, calls)), { agentId: AGENT, endpointUrl: URL_, toolSecret: SECRET });
    expect(r).toMatchObject({ toolId: "agent_tool_rs", toolAction: "updated", attached: false, agentToolCount: 1 });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual(["GET /v1/agents/tools", `GET /v1/agents/${AGENT}`, "PATCH /v1/agents/tools/agent_tool_rs"]);
    expect(calls[2]!.body).not.toHaveProperty("type");
  });

  it("prefers the attached copy when duplicates exist, and reports the others", async () => {
    const state = { tools: [{ id: "agent_tool_a", name: "record_statement" }, { id: "agent_tool_b", name: "record_statement" }], agentTools: ["agent_tool_b"] };
    const r = await ensureRecordStatementTool(new CartesiaClient(KEY, fakeCartesia(state)), { agentId: AGENT, endpointUrl: URL_, toolSecret: SECRET });
    expect(r).toMatchObject({ toolId: "agent_tool_b", attached: false, duplicateToolIds: ["agent_tool_a"] });
  });

  it("surfaces structured Cartesia errors without leaking the key", async () => {
    const failing: FetchLike = async () => json(401, { title: "Unauthorized", message: `bad key ${KEY}`, error_code: "invalid_api_key", request_id: "req_1" });
    const e = await ensureRecordStatementTool(new CartesiaClient(KEY, failing), { agentId: AGENT, endpointUrl: URL_, toolSecret: SECRET }).catch((x: unknown) => x);
    expect(e).toMatchObject({ kind: "http", httpStatus: 401 });
    expect((e as Error).message).toContain("Unauthorized");
    expect((e as Error).message).toContain("req_1");
    expect((e as Error).message).not.toContain("testkey123");
  });

  it("rejects malformed responses and missing configuration", async () => {
    const weird: FetchLike = async () => json(200, { unexpected: true });
    await expect(ensureRecordStatementTool(new CartesiaClient(KEY, weird), { agentId: AGENT, endpointUrl: URL_, toolSecret: SECRET })).rejects.toMatchObject({ kind: "malformed_response" });
    await expect(ensureRecordStatementTool(new CartesiaClient(KEY, weird), { agentId: "", endpointUrl: URL_, toolSecret: SECRET })).rejects.toMatchObject({ kind: "not_configured" });
    expect(() => new CartesiaClient("")).toThrow(/CARTESIA_API_KEY/);
  });
});
