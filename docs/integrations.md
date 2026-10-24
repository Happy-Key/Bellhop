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
- **Deposits read probe (2026-10-24, read-only, approved by the user):** `GET /accounts/{demo}/deposits` returns HTTP 200 with `[]`. The endpoint works, but the demo account has no deposits, so the read payload shape is still **UNVERIFIED**. Seeing it needs a seeded synthetic deposit, which is a write and needs approval. Needed to compare reported refunds and credits with records.
- **Simulated payout (implemented 2026-10-24; not yet run live):** `POST /accounts/{id}/deposits`.
  - The spec's `DepositCreate` requires `medium`, `transaction_date`, `status`, `amount` (**integer**) and `description`, and lists no allowed values for `medium` or `status`. We send `medium: "balance"` and `status: "completed"`, the values our verified purchase POSTs used.
  - The new id is read from `objectCreated._id`, as for other creates, or `_id`.
  - `depositOnce` first lists deposits and reuses one whose description carries `[claim <decisionId>]`, so a retry can't pay twice.
  - Non-whole-dollar amounts are refused and must be paid by a person.
  - **The first automatic approval on dev makes the first live deposit**, permanently, on the shared demo account. Check the result on the case page.
- Credentials: `NESSIE_API_KEY` and `NESSIE_DEMO_ACCOUNT_ID` go in **both** the Convex env (`npx convex env set …`) and `.env.local` (for the scripts).

## Runtime reasoning: selection

Claude Code is the development assistant only. **The app does not use the Anthropic API.**

1. **Cartesia (checked first).**
   - Cartesia Managed Agents use a hosted LLM chosen from a catalog of "models from OpenAI, Anthropic and Google Gemini". "You do not need a provider account or API key" (https://docs.cartesia.ai/agents/models.md). `GET /v1/agents/models` lists the models available to your account, with token prices.
   - That LLM is reachable **only inside an agent call** (audio over WebSocket or telephony). There is no documented text chat-completions endpoint, so it cannot interpret text-channel statements.
   - **Whether event credits cover agent LLM tokens: UNVERIFIED.** The CalHacks page (https://docs.cartesia.ai/calhacks) documents no credit amount.
2. **Bitdeer AI (chosen 2026-10-24 for extraction).** Docs re-checked 2026-10-24 (https://developers.bitdeer.ai/docs/api):
   - Base URL `https://api-inference.bitdeer.ai/v1`; `POST /v1/chat/completions`; `Authorization: Bearer {API_KEY}`. Works with the community `openai` client by setting `base_url`. **verified (docs)**
   - Keys: Bitdeer AI Console → API Keys, https://www.bitdeer.ai/en/model/apikeys. Credits: create an account at https://www.bitdeer.ai/en, then submit the sponsor credit form.
   - `GET /v1/models` lists the models a key can use (`npm run live:reasoning -- --models`).
   - Text models in the catalog (https://developers.bitdeer.ai/docs/api/models-catalog): `deepseek-ai/DeepSeek-V4.1-Flash`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `deepseek-ai/DeepSeek-V4-Flash`, `zai-org/GLM-5.3`, `zai-org/GLM-5.3-Flash`, `Qwen/Qwen3.8-27B`, `nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B`.
   - **UNVERIFIED (not in the docs):** `response_format` / JSON mode, `temperature`, rate limits, context lengths, latency. We don't send `response_format`. The provider accepts plain or ```json-fenced JSON and rejects anything else as `malformed_response`.
3. **CREAO.** An agent platform (`developer.creao.ai/v1`, runs/agents/webhooks). **No OpenAI-compatible inference was found.** Not suitable as a drop-in reasoning provider.

**Decision (2026-10-24):**
- The Cartesia agent handles the *conversation* on the voice channel.
- **Whole-case decision proposals (2026-10-24)** use the same Bitdeer config: `convex/caseReasoning.ts` sends the case (statements, records, provider facts, validated findings, AUTO-1 checks, curated legal sources) and gets back a proposal validated by `lib/domain/caseDecision.ts`. Since the investigation restructure (2026-10-24) it also returns the model's investigation (findings, hypotheses, uncertainties, work items, changes) and runs whenever the case state changes (a statement, no pending interpretation, bank records in), once per case state, and on "Reassess now" in `/review/<id>`. The voice webhook waits for it (12 s total budget) so the model chooses the next question; if it isn't ready, the rule question is used and logged as `rule_question_fallback`. Each run is one paid call with a larger prompt than extraction. Disable with `npx convex env set CASE_REASONING off`. **Not yet run live.**
- **Statement extraction is done by Bitdeer** through `OpenAICompatibleReasoningProvider` in Convex (`convex/reasoning.ts`), so text and voice share one interpreter. Until the env vars are set, `REASONING_PROVIDER=scripted` (labelled). There is never a silent fallback.
- The model gets the statement (after redaction), earlier statements, the question being answered (`questionAsked`), and the refs it may cite. Its output is schema-validated and its findings evidence-validated.
- Short replies are also read by the rule-based answer reader, in both modes.
- To avoid a second reasoning agent, the voice agent's prompt should only relay what the customer said and the backend's questions. It should not draw its own conclusions about the case.

**How to turn it on:**
1. In `.env.local`: `REASONING_BASE_URL=https://api-inference.bitdeer.ai/v1`, `REASONING_API_KEY=…`, `REASONING_PROVIDER_LABEL=bitdeer`.
2. `npm run live:reasoning -- --models` lists the models; pick one into `REASONING_MODEL`.
3. `npm run live:reasoning` interprets two synthetic statements, printing the latency and the parsed output.
4. Convex env: `npx convex env set REASONING_PROVIDER openai-compatible`, plus `REASONING_PROVIDER_LABEL bitdeer`, `REASONING_BASE_URL https://api-inference.bitdeer.ai/v1` and `REASONING_MODEL <id>`. Then `npx convex env set REASONING_API_KEY <key>` (type it in your terminal; never paste it in chat).
5. Record a statement on a synthetic case. It shows "pending", then "model: bitdeer:<model>", or a visible failure with Retry.

**Live results (2026-10-24, synthetic statements, our full prompt):**
- **Credits:** the CalHacks credits are not approved yet and the balance shows **$0.00**, but requests still succeed. **Bitdeer may start refusing at any moment.** Keep live requests to a minimum. A refusal now shows the provider's own reason on the case (`interpretation failed: HTTP 4xx: …`). On voice, a failed interpretation doesn't stall the call; the next question is still asked.
- **Models available to our key:** DeepSeek-V4.1-Flash, DeepSeek-V4-Flash, GLM-5.3, GLM-5.3-Flash, Qwen3.8-27B (plus embedding, reranker and image models).

  | Model | Time per statement | Notes |
  |---|---|---|
  | **`zai-org/GLM-5.3-Flash` (chosen)** | 4–8 s typical, one 24 s outlier | Correct on all three samples after the prompt fixes |
  | `deepseek-ai/DeepSeek-V4.1-Flash` | 11–13 s; one 30 s timeout | Correct, but too slow for voice |
  | `deepseek-ai/DeepSeek-V4-Flash` | 7–22 s; one timeout | Called "bank" a merchant; assumed a code was shared |
  | `Qwen/Qwen3.8-27B` | ~22 s; one timeout | Too slow |

- A minimal request takes **under 1 s** (about 50 output tokens, 45 of them `reasoning_tokens`; the response has a `reasoning_content` field). Our time goes into the long prompt and output.
- **Prompt fixes found by testing:**
  - Extract only what *this* statement says (models copied amounts and dates from earlier statements into "Me.").
  - Short labels: models wrote sentences, so over-long labels are now shortened to 80 characters instead of the whole output being rejected.
  - "Bank" is not a merchant; being asked for a code is not sharing it.
- **End-to-end on dev (2026-10-24):** "An unknown transaction for 5 dollars appeared in my account. I do not believe I authorized it." was read as `denies_authorization`; the next question was `credentials`. The scripted extractor had read the same sentence as `authorized`.
- **Voice (live call 2026-10-24):** Bitdeer took 5.0, 7.0 and 4.7 s on three statements. With the old 4.5 s wait, every turn was "anything more you'd like to add?" and no question was ever asked. Fixed:
  - The default wait is now **8 s** (capped at 12 s, under Cartesia's 15 s tool timeout).
  - Replies of 4 words or fewer, or ones the rule-based reader understood, don't wait at all.
  - The agent acknowledges at most once in a row; the next turn always asks a question.
  - Tune with `VOICE_INTERPRETATION_WAIT_MS`.
- **Thinking can't be switched off:** `thinking: {type: "disabled"}` and `chat_template_kwargs: {enable_thinking: false}` are both accepted, but each request still used about 45–50 `reasoning_tokens`. Not used.
- Model findings are re-keyed per statement (`S2-M1`), because models number them F1, F2… and collided with the rule-based IDs.
- **Dev deployment configured:** `REASONING_PROVIDER=openai-compatible`, `REASONING_PROVIDER_LABEL=bitdeer`, `REASONING_BASE_URL`, `REASONING_MODEL=zai-org/GLM-5.3-Flash`, `REASONING_API_KEY` (set from `.env.local`). To go back to scripted: `npx convex env set REASONING_PROVIDER scripted`.

**Data note:** with live extraction on, statement text leaves our backend for Bitdeer. That is fine for synthetic data. Real customer data would need the bank's vendor review and a data agreement.

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
  - `turn_id` is never sent. Cartesia gives webhook tools no turn ID (there is no `system__` turn variable).
  - **Since 2026-10-24 the key also names the question being answered.** The tool has an optional model-supplied `question_id` (an echo of the previous result's `question_id`). The backend accepts it only if it was issued on this call; otherwise it uses the last question issued. So "Yes." to two different questions is two statements, and a retried call (same question, same words) gets the stored response back. Remaining limitation: if the agent omits `question_id` and a call is retried *after* the next question was issued, the retry is filed against the newer question.
  - **Response (2026-10-24):** `{recorded, duplicate, question_id, question, next_questions:[question], awaiting_interpretation}`. `recommended_action` was removed: the agent never needs eligibility information. With live reasoning, the endpoint waits up to `VOICE_INTERPRETATION_WAIT_MS` (default 4500 ms) for the statement's interpretation. If it isn't ready, it returns `awaiting_interpretation: true` with an acknowledgement instead of a possibly stale question. A question asked twice on one call without being settled is not asked again; it is logged for a reviewer.
  - **Re-register the tool** (`npx convex run voiceSetup:registerVoiceTool`) after deploying these functions, so the agent gets the `question_id` parameter and the new description.
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
  > At the start of every call, before any questions, say that you are an automated assistant for the bank, that the call is transcribed (not recorded) to prepare their claim, and ask whether that's okay. If they say no, tell them they can file their claim in writing instead or ask for a person, then end the call. Do not call `record_statement` until they agree.
  >
  > You help a bank customer report a suspected fraudulent payment. After everything the customer says about the claim, including short answers like "yes" and corrections, call `record_statement` with their words exactly as said, and pass the `question_id` from the previous result. Its result is JSON. Ask the customer the result's `question`, in plain, natural language, and only that question. While the tool runs, use a short acknowledgement and vary it ("Got it.", "Thanks, one moment.", "Okay."); don't repeat the same phrase every turn. If `question` is null, ask whether there is anything else they want to add. Never ask for passwords, full card numbers or security codes; if the customer starts to read one out, stop them politely. Never decide whether fraud occurred, never say whether a payment was "authorized", never promise a refund, and never give legal advice; a human reviewer makes every decision. If the tool returns an error, apologize and ask the customer to repeat the last point. If the customer asks for a person, say a reviewer will follow up. When the customer says goodbye or asks to end the call, say a brief goodbye and end the call.
  >
  > (Updated 2026-10-24 for the `question`/`question_id` response, and for your decisions: an automated-assistant notice and transcription consent on every call; audio is not stored. **Check Cartesia's retention settings for this agent** to confirm it doesn't keep audio. Paste it into the Playground; it is not applied by the registration action.)
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
2. Bitdeer: credit amount, JSON-mode support, rate limits and latency per model (the live check script measures latency).
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

### CRS Fraud Finder (implemented and verified live 2026-10-24)
- Source: the CRS helper package's `dist/guides/fraud_finder.md` and `dist/test-data/personas.json` (package 1.1.2, read only, never run).
- **What it is:** an email-centred risk check (AtData). It scores the claimant's **email**, and cross-checks name, phone, address and IP against it. It says **nothing about whether a payment was authorized**; it only helps judge whether the person filing looks genuine.
- **Request:** `POST {base}/fraud-finder/fraud-finder` (config `fraud-finder`); `email` is required. **Only persona bodies are sent**: each persona's `fraud_finder` body is copied into `lib/fixtures/crsPersonas.ts` and checked byte-for-byte against the package file. Anything else goes to the real vendor.
- **Response:** `risk.score` from 0 to 100 (higher is riskier) and `email_validation.status`. CRS's own bands: ≤30 low, ≤60 medium, else high. Stored as `providerEvidence` with product `crs-fraud-finder-atdata` and refs `X:crs:<persona>:<requestId>:ff-score` / `:ff-email`.
- **Expected for our personas (CRS-documented):** P01 11, P19 9, P16 50, P12 85, P14 80.
- **Live check (2026-10-24):** P01 returned `risk_score = 11` and `email_status = valid`, matching the documentation.
- **Use in the app:** policy AUTO-1 v2 approves automatically only when the score is ≤ 30. A medium or high score adds a reviewer note and never denies.
- **CRS identity products listed but not used:** OTP, KBA, device and document verification. The public page shows no endpoints for them, and our access to them is unconfirmed.
- **Not used, deliberately:** credit reports, credit scores, criminal and eviction records. Judging fraud claims with them raises consumer-reporting (permissible purpose) and fairness issues.

### Payment-origin records (SYNTHETIC, 2026-10-24)
- A real bank would check each payment against its own authentication logs (device, two-factor, IP and location). **Nessie has no such data**, so the case page lets a reviewer attach a preset per transaction (`lib/fixtures/paymentOrigins.ts`), stored in `paymentOrigins` keyed by Nessie id:
  - "Customer's own device, two-factor passed, near home": blocks automatic approval.
  - "Chip and PIN near home": blocks it.
  - "New device, no two-factor, out of state": supports the claim.
- Always labelled SYNTHETIC. It must be replaced by the bank's real records before any real use.
