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
- **Customer turns (voice and text):** a call's utterance (webhook `convex/http.ts`) and a typed
  chat message (`convex/chat.ts`, customer page "Chat by text") go through the same path: a session
  bound to one case (`voiceSessions`, `channel` voice or text) → `recordVoiceUtterance` (statement
  linked to the question it answers) → `takeTurn` in `convex/intakeTurn.ts` (wait for interpretation
  and the model's reassessment) → `issueNextQuestion`: a reviewer's open question first
  (`convex/reviewerQuestions.ts`, asked from the case page), then the model's, then the rules' as the
  logged fallback. `chat.waitingQuestions` lists what the bank is still waiting on for a case.
- **`convex/`** holds persistence, idempotency, the activity log, and external calls in
  actions. It recomputes `cases.analysis` after every evidence change, so the UI reacts
  automatically.
- **The investigation is the model's:** whenever a case's state changes (and its bank records are
  in), the reasoning model reassesses the whole case. It returns its investigation (findings marked
  reported or corroborated, hypotheses, material uncertainties, and the investigative work items it
  chooses for this case) plus the next step: request information (with the question), escalate,
  approve or deny. `lib/domain/investigation.ts` and `lib/domain/caseDecision.ts` validate it (refs,
  provenance downgrades, blocking checks) and decide who acts; approval amounts are computed from the
  matched record. `convex/proposals.ts` stores every assessment with a code-computed diff against the
  previous one; `convex/caseReasoning.ts` calls Bitdeer. The voice agent asks the model's current
  question; the fixed rules are a guardrail (approve/deny blocked while they have blocking questions)
  and the labelled fallback when the model is off, still assessing or failed. Only the newest
  assessment for the current case state can be acted on.
- **`lib/review/`** holds pure view models for the bank workstation (`/review`): guided-intake
  progression, the timeline, findings groups, the decision trace, prepared-output states, the
  investigation-first case status (`caseStatus.ts`), and the pitch demo builder (`pitchDemo.ts`). It only re-reads stored
  data and decides nothing.
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
- **Demo personas (DEMO ONLY, 2026-10-24):** `/call` may name a SYNTHETIC persona
  (`lib/fixtures/demoPersonas.ts`), never an account. `personas.createForPersona` maps it to an
  account through the `NESSIE_PERSONA_ACCOUNTS` env var, links the persona's CRS test identity, and
  schedules `personaSetup.setUpCase` (retrieve records, then CRS identity check, then Fraud Finder:
  the same live calls as the case-page buttons). The persona's SYNTHETIC payment-origin records
  attach when records are stored, and never overwrite one already set. Cases opened without a
  persona get no automatic setup.
- **Removing a case (developer tool):** `cases.remove` deletes the case row first, then every row
  holding its `caseId` (every such table has a `by_case` index), in batches with a scheduled
  follow-up. Late writes from in-flight work can't leave orphans: `logActivity` skips a missing
  case and other writes fail on it and roll back. Payment-origin records (keyed by Nessie
  transaction) and anything in Nessie stay. `/call` may continue any existing case (DEMO ONLY:
  there are no customer logins yet).
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
- Voice: the key is `voice:<call>:<question turn>:sha256(normalized utterance)`. The question turn
  is the `question_id` the agent echoed (accepted only if issued on this call), else the last one
  issued. "Yes." to two different questions is two statements.
- `processedEvents` stores each key, and for voice the full tool response. A replay returns the
  original response with `duplicate: true`.

## Statement intake (both channels)

- **Sensitive values are removed before storage** (`lib/domain/redact.ts`): Luhn-valid card
  numbers, codes or PINs next to a keyword, passwords, SSNs. Only the kind is kept
  (`statements.redactions`).
- **Answers carry their question.** A voice statement stores `inResponseTo` (the question issued on
  the call) and a rule-based `answer` read against it (`lib/domain/answers.ts`): "me" / "someone
  else" / "yes, that one" / "I don't know". `unknown` and `declined` are answers: the question is not
  asked again, and a blocking one goes to a reviewer.
- **Questions** have a stable `key`, an `audience` (customer or reviewer) and a `priority`. Customer
  wording asks about actions ("Did you make the $23.00 payment to Corner Grocer on 2026-10-22
  yourself, or did someone else make it?"), never for a legal classification.
- **Questions are tailored to policy AUTO-1** (2026-10-24): they gather exactly what a legitimate
  claim needs to be approved automatically. Bank records do the identifying, so most answers are a
  yes or no about one named record (two possible records, or two amounts in one statement). Missing
  details are asked one at a time, exact amount first. The credential question asks what the
  customer *gave*, not what they were asked for. "I sent it" read from a free-form account is read
  back once (`confirm:authorization`). A reply that restates an amount or date settles it instead of
  creating a conflict (`settles()` in `lib/domain/facts.ts`).
- **Auto-linked corrections** point at the latest earlier statement that gave a value for the same
  field, not blindly at the previous one.
- **Live interpretation attempts** carry an `attemptId`. Only the statement's current attempt may
  write a result or a failure; anything else is logged as `stale_result_discarded`.
- **Evidence is append-only.** A changed Nessie record and replaced CRS results get `supersededAt`
  and stay in `cases.view().history`; nothing is deleted.

## Voice

- **Text and voice share one path:** `recordStatement` in `convex/model.ts`.
- Cartesia Managed Agent → webhook tool → Convex HTTP action. Only finalized utterances
  arrive, because the tool is invoked by the agent after a turn and not on partial
  transcripts.
- The tool response returns **one** backend-chosen question (`question`, `question_id`), so the
  agent asks what the workflow needs rather than inventing its own. Each issued question is logged
  in `intakeTurns`; one asked twice on a call without being settled is handed to a reviewer.
- With live reasoning, the endpoint waits up to `VOICE_INTERPRETATION_WAIT_MS` (default 4.5 s)
  for the new statement's interpretation, then answers `awaiting_interpretation: true` with an
  acknowledgement rather than a question that may already be answered.
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
