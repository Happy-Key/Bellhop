# CONTEXT.md: current project state

> Living summary of where the project stands. **Update it on every prompt that changes anything**: change
> the sections below and add an entry to the revision log at the bottom.
> Details live in `docs/status.md` (checklist), `docs/integrations.md` (verified provider
> facts), `docs/architecture.md` (design), and `CLAUDE.md` (rules).

_Last updated: 2026-10-24_

## What this is

A hackathon prototype of a **fraud claims investigator** for U.S. consumer bank accounts.

A customer describes a suspected fraudulent payment, by text now and by voice later. The app:
- matches the description against live (mock) bank records,
- pulls identity evidence from CRS,
- asks follow-up questions when facts are missing, ambiguous or conflicting,
- prepares an evidence-linked **draft** claim packet with potentially relevant
  regulatory considerations, for **human review**.

Rules that always hold:
- All data is synthetic.
- The app only recommends. It never moves money or approves anything.

## Current state at a glance

| Area | State |
|---|---|
| Web app (Next.js 16 + TypeScript) | ✅ Working: plain dashboard at `npm run dev` |
| Backend (Convex) | ✅ Cloud dev deployment linked (team `maximo-zhang`, project `calhacks`) |
| Bank records (Capital One Nessie) | ✅ **Live**: synthetic demo account seeded (5 purchases); retrieval verified |
| Identity evidence (CRS sandbox) | ✅ **Live**: TransUnion identity check on test personas; verified with P12 (3 issues) and P01 (clean) |
| Reasoning | ⚠️ **Scripted mode** (deterministic, labelled). Live model provider built but not configured |
| Voice (Cartesia) | ✅ **Live**: browser call from the case page works end to end (2026-10-24). The call is linked to the case by call ID; statements are recorded through the `record_statement` webhook tool; End call works. Quality issues are open (see below). Agent balance about $0.86 |
| Regulatory considerations | ✅ Curated official sources (Reg E and CFPB), scenario-scoped, no deadline math. 3 excerpts need word-for-word verification |
| Developer agent (Factory Droid) | ❌ Not started |
| Simulated reimbursement | ❌ Not started |
| Checks | ✅ `npm run verify`: typecheck, lint, 99 unit tests, production build all pass (2026-10-24) |
| Backend consistency fixes | ✅ Mock-tested 2026-10-24, **not yet pushed or run live** (see "What needs to be added" item 1) |

## What works today (end to end)

1. **Create a synthetic claim.** It is stored in Convex and bound to the Nessie demo account
   by the backend.
2. **Record a customer statement** (text). Each statement gets a stable ID (`S1`, `S2`, …)
   and is interpreted by the scripted extractor (amounts, dates, merchant, authorization,
   credential sharing, scam indicators).
3. **Retrieve bank records.** This is a live Nessie call. Failures are shown and never
   replaced with sample data.
4. **Match deterministically.**
   - A match is *clear* only when exactly one transaction fits.
   - Several fits make it *ambiguous*, and the app asks which one.
   - A reported merchant or date narrows the candidates.
5. **Follow-ups and corrections.** "Actually, it was the gift card one…" links to the
   original statement, which is preserved. Conflicting statements block the case until
   they're resolved.
6. **Run a CRS identity check.**
   - A reviewer links a CRS test persona; the link is labelled synthetic.
   - Results are stored as provider facts. Identity issues add a non-blocking reviewer
     note and never change the recommendation.
7. **Findings and questions.** Every finding cites evidence IDs. Findings that cite unknown
   evidence or make unsupported claims are rejected and shown.
8. **Draft packet and recommendation.** The recommendation is one of:
   - request clarification
   - further investigation
   - escalate (e.g. a customer-initiated scam payment)
   - reimbursement **review**
9. **Activity log and integration status** are on every case page.
10. **Voice calls.** The case page has a **Start voice call** button (`components/VoiceCall.tsx`).
    - Convex mints a 60 s Cartesia access token; the browser opens the agent WebSocket.
    - On `session_ready`, the browser binds `call_id` to a backend-issued voice session
      (`voice:bindVoiceCall`), then starts the microphone.
    - The agent's `record_statement` webhook tool POSTs each statement, with `call_id` filled from
      `system__conversation_id`, to `<deployment>.convex.site/voice/tools/record-statement`
      (bearer `VOICE_TOOL_SECRET`). It feeds the same workflow as text and ignores retries.
    - Calls are hard-capped at 3 minutes.

## Key design decisions

- **Convex is the single source of truth.** All external calls are Convex actions, and keys
  live only in the Convex environment. No backend logic in Next.js.
- **Evidence categories stay separate:** customer statement, transaction record, external
  provider, rule-based inference, model inference. Unresolved questions are their own list.
- **The backend decides account access.** Neither the client nor the model can choose a
  Nessie account or CRS identity.
- **Reasoning provider.**
  - The Cartesia agent's LLM only runs the voice conversation.
  - Case reasoning sits behind one swappable interface in Convex.
  - Live extraction is done through **Bitdeer** (decided 2026-10-24); not configured yet.
  - There's never a silent fallback to scripted mode.
- **CRS safety.**
  - Only CRS-published persona request bodies are sent, so no request is billable.
  - Logins are reused, and any failed login locks further attempts.

## What needs to be added (priority order)

1. **Live-test the consistency fixes (2026-10-24).** Mock-tested only. They address every item in the
   voice-quality list below:
   - Spoken amounts ("24 dollars and 99 cents", "a bill for 19.99"); "not X" drops the corrected amount.
   - Answers linked to the question asked (`inResponseTo`). Short replies are read against it (rule-based).
   - One question per turn, with `question_id`. "Yes." to different questions is no longer deduplicated.
   - No question is asked more than twice per call; after that it goes to a reviewer.
   - The legal "did you authorize?" question is replaced by "Did you personally enter and send this
     payment, or did someone else do that?"
   - Corrections link to the statement that gave the value.
   - Live interpretation: stale-attempt guard, plus a bounded 4.5 s wait in the webhook.
   - Card numbers and codes are removed before storage. Evidence is superseded, never deleted.
   - `recommended_action` is no longer sent to the agent.
   - Steps: push with `npx convex dev`, re-register the tool, paste the new agent instructions
     (`docs/integrations.md`), then make one live call.

   **Original voice-quality notes** (from the live browser test, 2026-10-24; case `jx72bbhya9tfz6ctaw67rt28sh8gxa6n`, S1–S7):
   - **Spoken amounts are missed.** `extractAmounts` (`lib/domain/interpret.ts:32`) only matches `$19.99`
     or "19.99 dollars".
     - "a bill for 19.99" gave `[]` (S3).
     - "24 dollars and 99 cents … not 19 dollars and 99 cents" gave `[24, 19]` (S5).
     - Fix: accept bare decimals in a money context, "N dollars and M cents", and probably spelled-out
       numbers. Add tests first.
   - **Answers lack context.** The customer's replies become "Yes." / "Yes. that one." (S6, S7), and the
     agent's question isn't stored. Proposed (deterministic, no model input): when the tool returns
     `next_questions`, store the question the agent was told to ask, and attach it to the next voice
     statement as `inResponseTo`. Show it in the dashboard. Optional extras: show agent turns in the
     activity log, or fetch the Cartesia transcript after the call (`GET /agents/calls/{call_id}`).
   - **The agent repeats itself.** It confirmed the $24.99 dispute twice, then asked for the amount again.
     Likely causes:
     - the backend keeps returning the same blocking question, because "yes" never resolves it
       (see the two items above);
     - the Playground prompt;
     - the scripted interpreter can't resolve ambiguity from short answers.
     - Fixing amounts and context should reduce it. Then tune the prompt.
   - **Voice corrections aren't linked.** S5 was a correction, but voice statements never set
     `correctsRef`. Consider detecting "actually / not X like I said" in the scripted interpreter.
   - **Smaller issues:** the merchant extractor over-captures ("Volt Electronics. I" in a text statement).
     Identical words said twice in one call are deduplicated (there is no turn ID).
   - **Still to do:** the welcome message and the rest of the Playground instructions. Lower the
     inactivity timeout. Add a login or rate limit before sharing the app URL (starting a call is
     public and billed).
2. **Live extraction through Bitdeer.** Claim the credits and create a key. Run `npm run live:reasoning`
   to pick a model and check latency. Then set the `REASONING_*` Convex env vars (steps in
   `docs/integrations.md`).
3. **Simulated reimbursement.** A Nessie deposit labelled SIMULATED, with explicit human
   approval and protection against running twice.
4. **Factory Droid loop.**
   - A recorded failure triggers a proposed regression test or patch, made in an isolated
     worktree.
   - The plan, diff and test results show in the dashboard.
   - A human merges.
5. **Regulatory.** Verify the paraphrased excerpts (1005.6, 1005.11, CFPB FAQ) word for word.
6. **Optional:** CRS Fraud Finder risk score; user auth before any non-synthetic use.

## Waiting on you

- **Claim-intake redesign:** decisions recorded 2026-10-24 (`docs/claim-intake-design.md` section I).
  - Consumers file claims; the software is an extension of the bank.
  - Cases can hold several payments; labelled deadline estimates and both screens are allowed.
  - Credit cards get full support. Demo login now, bank SSO later. Keep the 3-minute cap.
  - Calls are transcribed only, with consent and an AI notice on every call. Extraction uses Bitdeer.
- **Bitdeer:** claim the credits, create a key at https://www.bitdeer.ai/en/model/apikeys, then follow
  "How to turn it on" in `docs/integrations.md`.
  - Still for you: check Cartesia's retention settings so audio isn't kept.
- **Voice fixes go-live:** run `npx convex dev` (pushes the new schema and functions to cloud dev),
  then `npx convex run voiceSetup:registerVoiceTool`, then paste the updated agent instructions from
  `docs/integrations.md` into the Playground.

- **Cartesia:** tune the Playground prompt (repetition) and lower the inactivity timeout. The balance
  is about $0.86 until the promo code is applied; the last call cost $0.05. Re-run
  `voiceSetup:registerVoiceTool` whenever the tool definition changes.
- **Factory:** API key and `droid` CLI install, when we reach that step.
- **Housekeeping:**
  - Rotate the CRS password at some point; it was pasted in chat.
  - Review and merge the `foundation` branch when ready (pushed to `origin/foundation`; open a PR at https://github.com/Happy-Key/CalHacks/pull/new/foundation).

## How to run

```
npx convex dev    # terminal 1: backend (cloud dev deployment)
npm run dev       # terminal 2: http://localhost:3000
npm run verify    # all checks
```

Configuration: see `README.md` and `.env.example`. Never paste keys into chat.

---

## Revision log

| Date | Change |
|---|---|
| 2026-10-23 | Foundation: Next.js + Convex scaffold, domain workflow, deterministic matching, findings validation, regulatory sources, dashboard, tests, docs |
| 2026-10-23 | Cartesia project rules added to `CLAUDE.md`; structured Cartesia errors surfaced |
| 2026-10-23 | Nessie live: demo account seeded, purchase body verified, live retrieval through Convex |
| 2026-10-23 | Convex moved to a cloud dev deployment (done by user) |
| 2026-10-23 | CRS identity check implemented and verified live (P12, P01); persona re-link clears stale evidence |
| 2026-10-23 | `VOICE_TOOL_SECRET` generated and set; voice endpoint now enforces auth |
| 2026-10-23 | `CONTEXT.md` created |
| 2026-10-23 | First commit of the foundation on branch `foundation` (secret scan clean; not pushed) |
| 2026-10-23 | Status updates now required on every prompt: rule in `CLAUDE.md` plus a `UserPromptSubmit` reminder hook in `.claude/settings.json` |
| 2026-10-23 | Cartesia docs checked: dynamic variables go in `session_create`; agent WebSocket protocol corrected in `docs/integrations.md` |
| 2026-10-23 | `foundation` commits re-authored as `maximozhang` and pushed to `origin/foundation` |
| 2026-10-23 | Cartesia webhook-tool registration action (`voiceSetup:registerVoiceTool`) with 8 mocked tests; dry run verified on cloud dev; not run live |
| 2026-10-24 | User ran tool registration live (created and attached) and pasted the instructions; clarified that `next_questions` is a response field, not a tool |
| 2026-10-24 | First live voice test passed (Playground → webhook tool → Convex → dashboard). Found `end_call` not enabled; usage recorded |
| 2026-10-24 | Committed and pushed tool registration (`ed41f61`). Browser call client built: `components/VoiceCall.tsx` + `lib/voice/`, 9 new tests; not run live |
| 2026-10-24 | Live browser call failed: `dynamic_variables_not_allowed` for browser tokens. Switched to binding by call ID (`bindVoiceCall`, tool sends `system__conversation_id`); 74 tests pass; tool needs re-registering |
| 2026-10-24 | **Bitdeer reinstated** as the extraction provider (user reversed the removal). Docs re-checked; the model now gets the question being answered; `npm run live:reasoning` check script added; integration steps in `docs/integrations.md` |
| 2026-10-24 | Decisions on the 13 questions recorded. CLAUDE.md scope widened; Bitdeer removed from docs and code comments; CFPB FAQ excerpt in `regulatory.ts` replaced with word-for-word quotes (user-approved); Nessie deposits read probe (200, empty); consent and AI notice added to the agent instructions |
| 2026-10-24 | Backend consistency fixes: question keys, audience and priority; answers linked to questions; `question_id` voice flow; no-repeat; stale-attempt guard; bounded interpretation wait; redaction on ingest; append-only evidence; correction targeting; spoken amounts; action-based initiation question. 99 tests pass; not pushed or run live |
| 2026-10-24 | Design proposal `docs/claim-intake-design.md`: fact model, adaptive voice intake, reimbursement and legal-review screens, rule registry, phased plan. No code changed; Reg E 1005.6(b), 1005.11 and CFPB EFT FAQs re-checked live. Awaiting decisions in its section I |
| 2026-10-24 | **Live browser voice call worked** (call-ID binding confirmed: `system__conversation_id` = `session_ready.call_id`); End call works; $0.05. Logged issues: spoken amounts and cents missed, answers lack the agent's question, agent repeats itself, voice corrections unlinked |
