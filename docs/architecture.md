# Architecture

```
Browser (Next.js App Router, plain React)
  │  useQuery / useMutation / useAction  (Convex React client, reactive)
  ▼
Convex (source of truth)
  ├─ mutations: cases.createSynthetic, cases.submitStatement, statements.*, voice.createVoiceSession
  ├─ actions:   nessie.retrieveBankEvidence (live HTTP), reasoning.interpretLive, voice.createCartesiaAccessToken
  ├─ internal:  voiceSetup.registerVoiceTool (CLI only: registers and attaches the Cartesia webhook tool)
  ├─ http:      POST /voice/tools/record-statement  (Cartesia webhook tool)
  └─ tables:    cases, statements, transactions, providerEvidence, activity, processedEvents, voiceSessions
        │
        └─ imports pure domain code from lib/domain (same code the tests exercise)

External: Nessie (read-only) · reasoning provider (OpenAI-compatible, optional) · Cartesia · [CRS] · [Factory: dev-side]
```

## Layers

- **`lib/domain/`** is pure and browser-safe, with no I/O. It holds the schemas (zod), the
  scripted interpretation, fact aggregation (corrections and conflicts), deterministic
  matching, finding validation, regulatory considerations, and `analyzeCase` (the workflow).
- **`lib/providers/`** holds typed clients behind interfaces (`BankingProvider`,
  `ReasoningProvider`). They take an injectable `fetch` so tests run on mocks. Errors are a
  typed `ProviderError` with secrets redacted.
- **`convex/`** holds persistence, idempotency, the activity log, and external calls in
  actions. It recomputes `cases.analysis` after every evidence change, so the UI reacts
  automatically.
- **`app/` and `components/`** are a plain dashboard. There is no backend logic in Next.js:
  no API routes, and no duplicated backend.

## Workflow

`analyzeCase` maps evidence to a stage:

`intake → retrieve_evidence → (match) → clarify_facts → assess_considerations → human_review`

- Blocking questions (conflicts, ambiguity, no match, missing details, a retrieval failure)
  always return the case to `clarify_facts`.
- "Prepare packet" is computed on every recompute: `packet.readyForHumanReview` is true only
  at `human_review`.
- The recommendation is always one of `request_clarification`, `further_investigation`,
  `escalate` or `reimbursement_review`. **There is no approve action.**

## Evidence and identifiers

| Ref | Kind |
|---|---|
| `S<n>` | customer statement (per case, never edited) |
| `T:<nessie id>` | transaction record |
| `X:<provider>:<id>` | external provider fact (CRS, future) |
| `R:<source id>` | curated regulatory source |

Every finding passes `validateFinding`, which rejects a finding when:
- it cites an unknown reference,
- its category doesn't match the kinds of evidence it cites,
- it marks a customer statement or a model inference as `established`,
- one of its `assertions` (amount, date or merchant) disagrees with the cited record.

Rejected findings are shown in the UI and logged.

## Security boundaries

- Permanent keys (Nessie, Cartesia, reasoning, CRS) live only in the **Convex environment**.
  The browser only ever receives a short-lived Cartesia access token.
- **Account access is decided by the backend:** `cases.nessieAccountId` is set from
  `NESSIE_DEMO_ACCOUNT_ID`. No client or model argument can choose an account. Nessie IDs are
  format-checked before they are used in a URL.
- Voice tool calls are tied to a case through a backend-issued voice session (30-minute TTL).
  The browser binds Cartesia's `call_id` to the session once (`voice.bindVoiceCall`: one call per
  session, one session per call). The tool sends that ID from `system__conversation_id`, and is
  authenticated with the `VOICE_TOOL_SECRET` bearer token.
- Statement text is evidence only. The LLM prompt says so explicitly, and model output is
  schema-validated, then evidence-validated.
- Financial access is read-only. No money-movement code path exists yet.
- The public Convex functions have **no user auth** (hackathon prototype with synthetic data).
  Add auth before using any non-synthetic data.

## Idempotency

- Text: the browser generates `clientEventId` per submit, keyed as `text:<case>:<id>`.
- Voice: the key is `voice:<session>:sha256(turn_id or normalized utterance)`.
- `processedEvents` stores each key. A replay returns the original statement ref with
  `duplicate: true`.

## Voice

- **Text and voice share one path:** `recordStatement` in `convex/model.ts`.
- Cartesia Managed Agent → webhook tool → Convex HTTP action. Only finalized utterances
  arrive, because the tool is invoked by the agent after a turn and not on partial
  transcripts.
- The tool response returns the backend's blocking questions, so the agent asks what the
  workflow needs rather than inventing its own.
- Browser call client: `components/VoiceCall.tsx` on the case page, using `lib/voice/` (pure PCM and
  protocol helpers).
  - Steps: microphone permission, then `voice.createVoiceSession`, then `voice.createCartesiaAccessToken`
    (agent grant, 60 s), then `wss://api.cartesia.ai/v1/agents/websocket/{agent_id}?access_token=…`.
  - On `session_ready`, the browser calls `voice.bindVoiceCall(sessionToken, call_id)` and only then starts
    the microphone, so a tool call can't arrive before the binding exists. (Browser tokens may not send
    `dynamic_variables`.)
  - Microphone audio goes through an AudioWorklet, is resampled to 16 kHz and sent as 40 ms
    `pcm_16000` chunks. Agent audio is scheduled with Web Audio and stopped immediately on
    `audio_output_clear`.
  - The transcript in the UI is display only. Statements are recorded by the webhook tool.
  - Calls are hard-capped at 3 minutes (billed per minute).

## Live reasoning

- `REASONING_PROVIDER=openai-compatible` sends new statements to
  `reasoning.interpretLive` with status `pending`.
- On failure the status becomes `failed` and the UI offers "Retry live" or an *explicitly
  labelled* scripted interpretation. **There is never a silent fallback.**
