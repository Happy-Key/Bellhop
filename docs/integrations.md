# Integrations

Research date: **2026-10-23**. Facts below come from official docs, sponsor resources, or
read-only probes. They are marked **verified** (read in official docs or observed), or
**UNVERIFIED** (not confirmed: do not rely on it). Nothing here has been tested with our own
credentials yet unless the status says so.

| Service | Role | Status |
|---|---|---|
| Capital One Nessie | Mock bank records (read-only), later simulated payout | **Live, verified 2026-10-23**: demo account seeded, retrieval run through Convex |
| Runtime reasoning | Statement interpretation and follow-ups | **Scripted mode active.** OpenAI-compatible provider implemented but not configured |
| Cartesia | Voice | **Partial.** Backend tool endpoint, session binding and token minting are implemented. Browser call client and agent configuration are not done |
| CRS Credit API | Identity evidence | **Live, verified 2026-10-23**: TransUnion basic identity check on test personas P12 (3 issue codes) and P01 (verified) through Convex |
| Factory Droid SDK | Reviewed improvement proposals | **Not implemented.** SDK and CLI researched |

---

## Capital One Nessie

- Docs: https://nessieisreal.com/docs · Spec: https://nessieisreal.com/nessie-openapi-spec.yaml · Setup: https://nessieisreal.com/getting-started
- Base URL `https://api.nessieisreal.com`, auth via the `?key=` query parameter. You get the key by logging in with GitHub at nessieisreal.com (verified).
- Endpoints used (read-only, in `lib/providers/nessie.ts`): `GET /accounts/{id}`, `GET /accounts/{id}/purchases`, `GET /merchants/{id}`.
  - `GET /accounts/{id}/purchases` exists live but **is not in the OpenAPI spec**. Live validation errors show the stored fields are `merchant_id`, `purchase_date` and `status`, while the docs list `transaction_date`. The client accepts both.
- The seed script (`scripts/seed-nessie.ts`) uses `POST /customers`, `POST /customers/{id}/accounts` and `POST /merchants` (all in the spec), and `POST /accounts/{id}/purchases`.
  - The purchase POST body `{merchant_id, medium, purchase_date, amount, status, description}` was **verified live** on 2026-10-23: it returns 201 "Purchase created", and the read-back shows the fields stored as sent.
- Gotchas (verified by probe):
  - Amounts may be stored as **integers** (an $18.06 transfer was stored as 18). The demo uses whole dollars, and the matcher treats a sub-dollar difference as approximate only.
  - IDs are 36-character UUIDs, although the spec says 24-character.
  - **Data is visible across all API users** through the enterprise endpoints. Synthetic data only.
  - Unknown routes return 403 "Missing Authentication Token" (API Gateway). That does not mean a bad key.
  - No rate limits are documented, and no data-wipe endpoint was found.
- Simulated payout candidate: `POST /accounts/{id}/deposits` with `{medium, transaction_date, status, amount, description}` is fully defined in the spec. The transfer POST body is UNVERIFIED. Not implemented.
- Credentials: `NESSIE_API_KEY` and `NESSIE_DEMO_ACCOUNT_ID` go in **both** the Convex env (`npx convex env set …`) and `.env.local` (for the scripts).

## Runtime reasoning: selection

Claude Code is the development assistant only. **The app does not use the Anthropic API.**

1. **Cartesia (checked first).**
   - Cartesia Managed Agents use a hosted LLM chosen from a catalog of "models from OpenAI, Anthropic and Google Gemini". "You do not need a provider account or API key" (https://docs.cartesia.ai/agents/models.md). `GET /v1/agents/models` lists the models available to your account, with token prices.
   - That LLM is reachable **only inside an agent call** (audio over WebSocket or telephony). There is no documented text chat-completions endpoint, so it cannot interpret text-channel statements.
   - **Whether event credits cover agent LLM tokens: UNVERIFIED.** The CalHacks page (https://docs.cartesia.ai/calhacks) documents no credit amount.
2. **Bitdeer AI.**
   - Starter pack: "API credits for all participants", amount not stated. Claim them by creating an account at https://www.bitdeer.ai/en, then submitting the credit form linked from the sponsor resources, then creating a key in Model Studio.
   - OpenAI-compatible API: `POST https://api-inference.bitdeer.ai/v1/chat/completions` with Bearer auth. The docs say it supports "streaming, tools, and vision" (https://developers.bitdeer.ai/docs/api).
   - Chat models listed include `deepseek-ai/DeepSeek-V4.1-Flash`, `zai-org/GLM-5.3` and `Qwen/Qwen3.8-27B` (https://developers.bitdeer.ai/docs/api/models-catalog). **Which models support tool calling: UNVERIFIED.**
3. **CREAO.** An agent platform (`developer.creao.ai/v1`, runs/agents/webhooks). **No OpenAI-compatible inference was found.** Not suitable as a drop-in reasoning provider.

**Decision (pending your confirmation):**
- The Cartesia agent handles the *conversation* on the voice channel.
- Case reasoning (statement interpretation) stays behind `ReasoningProvider` in Convex, so text and voice share one interpreter.
- For live interpretation the candidate is **Bitdeer** through `OpenAICompatibleReasoningProvider`, once credits are claimed. Until then, `REASONING_PROVIDER=scripted`. This is labelled everywhere and never used as a silent fallback.
- To avoid a second reasoning agent, the voice agent's prompt should only relay what the customer said and the backend's questions. It should not draw its own conclusions about the case.

To enable live reasoning, set these in Convex env: `REASONING_PROVIDER=openai-compatible`, `REASONING_PROVIDER_LABEL=bitdeer`, `REASONING_BASE_URL=https://api-inference.bitdeer.ai/v1`, `REASONING_MODEL=<model id from catalog>`, `REASONING_API_KEY=…`.

We do not yet know whether the chosen model honours JSON-only output. The provider rejects malformed output (tested with mocks).

## Cartesia (voice)

- CalHacks page: https://docs.cartesia.ai/calhacks. Keys at https://play.cartesia.ai/keys, stored as `CARTESIA_API_KEY`: "Never put it in browser or mobile code."
- **The Line SDK (code-first agents) stops being hosted on Dec 1, 2026.** Use **Managed Agents** (https://docs.cartesia.ai/agents/introduction.md).
- API version header: `Cartesia-Version: 2026-08-14`.
- Browser auth: the server calls `POST https://api.cartesia.ai/access-token` with `{grants:{agent:true}, expires_in:60}` and gets back `token`. Implemented in `convex/voice.ts:createCartesiaAccessToken`, but **not yet run live**. The response schema beyond `token` is UNVERIFIED.
- Agent WebSocket (verified in docs 2026-10-23: https://docs.cartesia.ai/line/integrations/websocket-api.md, https://docs.cartesia.ai/api-reference/agents/agent-websocket.md): `wss://api.cartesia.ai/v1/agents/websocket/{agent_id}?cartesia_version=2026-08-14&access_token=<token>`. The browser uses `access_token`; servers use the `X-API-Key` header. (Our earlier notes on `/agents/stream`, `start` and `media_input` were wrong.)
  - First message, within 10 s: `session_create` with `audio.input_format` (`pcm_16000|pcm_24000|pcm_44100|mulaw_8000`, headerless mono), optional `output_delivery`, `continuous_input`, and `dynamic_variables` (up to 64; string, number or boolean values). Unknown fields are rejected.
  - Wait for `session_ready` (`call_id`, `agent_version_id`), then send `audio_input` with base64 audio in 20–100 ms chunks, as JSON text frames only.
  - Server sends `audio_output` (same format as the input), `audio_output_clear` (barge-in: stop playback), `client_tool_call`, `turn_started`, `turn_output_text_delta`, `turn_ended`, and `error` (`fatal` flag).
  - The server closes the socket after 120 s with no client event. Close with code 1000 when done.
- **Webhook tools** (https://docs.cartesia.ai/agents/webhook-tools.md): created with `POST /v1/agents/tools` (`type:"webhook"`), HTTPS only, auth via bearer `authentication`.
  - Parameters can come from the model, a `constant_value`, or a `dynamic_variable`.
  - The 2xx body goes back to the LLM (16 KiB maximum). The default timeout is 20 s.
- Our endpoint: `POST https://<deployment>.convex.site/voice/tools/record-statement` with Bearer `VOICE_TOOL_SECRET`. The body is `{call_id | session_token, utterance, turn_id?}`: exactly one of `call_id` or `session_token`.
  - The case identifier must never be a model parameter. The backend issues a voice session per case through `voice:createVoiceSession`.
  - **Live finding 2026-10-24:** browser access tokens **cannot** send `session_create.dynamic_variables`. Cartesia returns the fatal error `dynamic_variables_not_allowed`: "Browser access tokens cannot supply dynamic_variables; use a Cartesia API key." Our earlier reading of the docs was wrong; the guide's "from your server" wording is enforced.
  - **Current design (2026-10-24):** the tool sends `call_id` from the system variable `system__conversation_id` (documented as the "Cartesia call ID"). On `session_ready`, the browser binds `call_id` to its voice session with `voice:bindVoiceCall` and only then starts the microphone. **Verified live 2026-10-24:** `system__conversation_id` equals `session_ready.call_id`. A browser call recorded S1–S7 by call ID.
  - `session_token` in the body is kept for direct HTTP testing only. Playground previews can no longer record statements, because nothing binds their call ID.
  - `turn_id` is never sent. Cartesia gives webhook tools no turn ID (there is no `system__` turn variable), so retries are deduplicated by utterance text. **Known limitation:** if a customer says exactly the same words twice in one session, the second statement is ignored as a duplicate.
- `next_questions` is **not** a Cartesia tool. It is a field in our endpoint's JSON response, which Cartesia hands to the LLM as the tool result.
- **Tool registration (implemented 2026-10-23; the user ran the dry run and the live registration on 2026-10-24, and the output matched what was expected):** `npx convex run voiceSetup:registerVoiceTool`, an internal action in `convex/voiceSetup.ts` with its client in `lib/providers/cartesia.ts`.
  - Docs used: https://docs.cartesia.ai/api-reference/agents/tools/create.md and https://docs.cartesia.ai/api-reference/agents/update.md.
  - Endpoints: `GET /v1/agents/tools?type=webhook` (paginated with `starting_after`), then `POST /v1/agents/tools` or `PATCH /v1/agents/tools/{id}`, then `GET` and `PATCH /v1/agents/{agent_id}`.
  - **`config.tools` (`[{id}]`) replaces the whole list on update**, so the action merges with the tools already attached. Every config change creates a new immutable agent version; we tag ours with `version_description`.
  - Idempotent: it finds the `record_statement` tool by name and updates it (refreshing the URL and secret) instead of creating a duplicate, and attaches it only if it isn't already attached.
  - The webhook URL is the deployment's `CONVEX_SITE_URL` + `/voice/tools/record-statement`. Non-HTTPS URLs are refused.
  - The secret is sent as a write-only `{"type":"secret","secret_value":…}`; Cartesia never returns it.
  - `{"dryRun": true}` makes no network calls and prints the definition with the secret redacted. Verified on the cloud dev deployment: the URL is `https://dynamic-chihuahua-120.convex.site/voice/tools/record-statement`, and the endpoint returns 401 without the bearer secret.
- **Suggested agent instructions** (set in the Playground; not applied by the action):
  > You help a bank customer report a suspected fraudulent transaction on their deposit account. After every complete statement the customer makes about the claim, including corrections, call `record_statement` with their words exactly as said. Its result is JSON; ask the customer the first item in the result's `next_questions` list, in plain language. If that list is empty, ask whether there is anything else about the transaction they want to add. Never decide whether fraud occurred, never promise a refund, and never give legal advice; a human reviewer makes every decision. If the tool returns an error, apologize and ask the customer to repeat the last point. When the customer says goodbye or asks to end the call, say a brief goodbye and end the call.
- **Ending calls:** the agent can only hang up if the `end_call` system tool is enabled (Playground → Tools, or `config.system_tools.end_call: {}`). See https://docs.cartesia.ai/agents/system-tools.md. Without it, the call runs until the caller hangs up or `config.turn.inactivity_end_call_secs` passes (20–240 s; the default is 240). Our registration action PATCHes only `config.tools`, and omitted system tools are left unchanged, so re-running it is safe.
- **First live test (user, 2026-10-24):** a Playground preview with a `session_token` sample value (the original tool design). The tool reached Convex, statements were recorded as voice, and the dashboard updated live. Billing: about 25k LLM tokens, and $0.09 of "voice agent dollars" ($1.00 → $0.91). Credits were unchanged, which matches the pricing docs (agents are billed in USD per minute plus LLM tokens, not in credits). The call did not end when asked to, because `end_call` was not enabled.
- **First live browser call (user, 2026-10-24):** connected, the agent spoke, statements were recorded through the call-ID binding, and End call worked when asked. Cost $0.05. Quality issues are tracked in `CONTEXT.md` (spoken amounts, missing agent-question context, repetition).
- Webhooks (call events): the `x-webhook-secret` header, up to 3 retries, dedupe by `webhook_request_id`, and `call_turn` events with a transcript. Not implemented; the tool endpoint is the primary path.
- STT streaming (only if we build our own STT path): `wss://api.cartesia.ai/stt/turns/websocket` emits `turn.end` as the definitive transcript. On `/stt/websocket`, use `is_final`.
- Local development: Cartesia can only reach a **public HTTPS** URL. The local Convex backend (127.0.0.1) won't work for the tool, so voice testing needs a cloud Convex dev deployment.

## CRS Credit API sandbox (identity check implemented)

- Event page: https://calhacks.crscreditapi.com. Request access with the invite form; credentials and a Postman collection arrive by email.
- MCP package with product guides, OpenAPI and personas: `@crscreditapi/crs-calhacks-mcp-server` (read, not run).
- Base URL `https://api-sandbox.stitchcredit.com:443/api`. Log in with `POST /users/login {username,password}` to get a `token`, then send `Authorization: Bearer`.
  - **Log in once and reuse the token.** Repeated failed logins disable the account (`CRS113`/`CRS114`).
- Most relevant products:
  - TransUnion identity verification: `POST /transunion/identity-manager-verification/basic`. Read `addOnProducts[0].idManagerVerification.messages[]`; it is empty when verified.
  - Fraud Finder: `POST /fraud-finder/fraud-finder`, which returns `risk.score` from 0 to 100.
- **Use only the provided test personas** (SSNs in the form `6667010NN`), with their full request bodies. A request that doesn't match a persona goes to the real vendor and **may be billable**. Check `GET /users/logs` for `billable:false`.
- CRS identities and Nessie customers are separate datasets. Any link between them for the demo is **synthetic and must be labelled** (`syntheticAssociation: true` in `providerEvidence`).
- Interpretation limits: an identity-check mismatch is **not** proof of a false claim. CRS does not verify beneficiary ownership, detect account takeover, or decide reimbursement eligibility.

## Factory Droid SDK (not implemented)

- TS: `@factory/droid-sdk` (`import { run } from '@factory/droid-sdk/node'`). Python: `droid-sdk`. Both need the `droid` CLI on PATH (https://docs.factory.com/sdk/typescript).
- Auth: `FACTORY_API_KEY` (developer machine only; never Convex or the browser).
- Autonomy:
  - The default run is **read-only**.
  - `--auto low` allows file edits.
  - `medium` adds builds, tests and commits.
  - Plan-only: `--use-spec`.
  - `-w/--worktree` gives an isolated git worktree.
  - Output formats include `json` and `stream-json`.
- Prize criteria (sponsor resources): Droid does real work in the product, runs on a trigger you designed, has bounded permissions, and its plans, diffs and results are visible.
- Plan:
  1. A recorded failure (for example a rejected finding or a matcher outcome a reviewer flags) creates a task.
  2. Droid runs in a worktree at `--auto low` to propose a regression test and patch.
  3. The diff and test results are shown in the dashboard.
  4. A human merges. Droid never edits `lib/domain/regulatory.ts` or reimbursement rules.
- Credits for Factory: UNVERIFIED (the starter-pack doc needs a Google login).

## Unresolved questions

1. Cartesia: event credit amount, and whether Managed Agent LLM tokens are covered. (Dynamic-variable passing is resolved; see the Cartesia section.)
2. Bitdeer: credit amount, which models support tool calling and JSON output, and the rate limits.
3. Nessie: the purchase and transfer POST bodies (the seed script will reveal the purchase body).
4. CRS: your account's rate limit, and whether non-persona requests cost anything. The OFAC and military endpoints mentioned on the event page aren't in the OpenAPI spec.
5. Factory: credits, and whether `run()` accepts an autonomy level directly.

### CRS implementation notes (2026-10-23)
- Code: `lib/providers/crs.ts`, `convex/crs.ts` (action), `convex/crsData.ts`. The test personas are in `lib/fixtures/crsPersonas.ts` (P01, P12, P14, P16, P19), copied verbatim from the CRS persona file.
- Token handling:
  - The token is cached in the server-only `providerAuth` table and reused until 60 s before it expires.
  - A 401 clears the token and triggers exactly one re-login.
  - Any rejected login sets a lock. Clear it with `npx convex run crsData:unlockLogin` once the credentials are fixed.
- Billing guard: request bodies come only from the persona fixtures, and the SSN must match `6667010NN`.
- Re-linking a different persona removes the earlier persona's CRS evidence.
- Live results: P12 returned codes 2201, 2202 and 2101, matching CRS's documented "FAIL". P01 returned no messages, matching "PASS".
