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
- Our endpoint: `POST https://<deployment>.convex.site/voice/tools/record-statement` with Bearer `VOICE_TOOL_SECRET`. The body is `{session_token, utterance, turn_id?}`.
  - `session_token` must be a **dynamic variable**, not a model parameter. The backend issues it per case through `voice:createVoiceSession`.
  - **Resolved 2026-10-23:** the browser sends it as `session_create.dynamic_variables.session_token` (https://docs.cartesia.ai/agents/dynamic-variables.md). The tool's body property is `{"type":"string","dynamic_variable":"session_token"}`. If the value is missing, the agent gets a tool error and no request is sent. The guide says "from your server", but the reference does not restrict access-token sessions. Not yet tested live.
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
