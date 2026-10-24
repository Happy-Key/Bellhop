# Status checklist

Legend: [x] done and tested · [~] implemented, not yet verified live · [ ] not started

## Phase 1: Foundation
- [x] Next.js 16 App Router, strict TypeScript, ESLint, Vitest, `npm run verify`
- [x] Convex schema, mutations, queries, actions, HTTP router (local anonymous deployment works)
- [x] Domain types and zod validation; provider interfaces
- [x] Plain case dashboard (statements, evidence, findings, questions, packet, activity, integration status)

## Phase 2: Financial evidence
- [x] Live Nessie retrieval (verified 2026-10-23 against the seeded demo account)
- [x] Seed script for the synthetic demo account (run 2026-10-23; purchase body verified)
- [x] Deterministic matching: clear, ambiguous, narrowing, tentative, no match
- [x] Integration errors are shown clearly, with no fixture substitution
- [x] Follow-up statements and corrections update the same case

## Phase 3: Voice and reasoning
- [x] Shared statement path for text and voice; idempotent retries
- [x] Cartesia webhook-tool endpoint (called by Cartesia live, 2026-10-24)
- [x] Cartesia access-token minting (live, 2026-10-24)
- [x] Browser call client (`components/VoiceCall.tsx`): live call verified 2026-10-24
- [x] Webhook tool registration: `voiceSetup:registerVoiceTool` (idempotent; mock-tested; run live by the user 2026-10-24, tool created and attached)
- [~] Managed Agent instructions pasted into the Playground (welcome message and the rest of the prompt not done yet)
- [x] First live call (Playground preview, 2026-10-24): `session_token` dynamic variable → webhook tool → Convex → dashboard
- [x] Found live: browser tokens can't send dynamic variables. Switched to call-ID binding (`voice:bindVoiceCall` + `system__conversation_id`); tested with convex-test; tool must be re-registered
- [x] `end_call` system tool enabled (works live)
- [ ] Lower the inactivity timeout; finish the welcome message and prompt
- [x] Voice quality fixes (2026-10-24, mock-tested; not yet run live): spoken amounts and cents; answers linked to the question asked (`inResponseTo`, rule-based answer reading); one question per turn with `question_id`; no question more than twice per call; correction targeting; stale-attempt guard; bounded wait for live interpretation
- [x] Sensitive values removed before storage; evidence history kept (superseded, not deleted)
- [ ] Re-register the tool and paste the updated agent instructions (`docs/integrations.md`), then test live
- [ ] Claim-intake redesign (`docs/claim-intake-design.md`): waiting on decisions
- [x] Live extraction via Bitdeer (`zai-org/GLM-5.3-Flash`), enabled on the dev deployment and verified end to end with a text statement (2026-10-24). CalHacks promo active (2026-10-24); the $0.00 balance Bitdeer shows is a display bug
- [ ] Voice call with Bitdeer on: tune `VOICE_INTERPRETATION_WAIT_MS`

## Phase 4: CRS evidence
- [x] Login once, reuse the token, lock on failure (`npx convex run crsData:unlockLogin` to clear)
- [x] TransUnion basic identity check for published test personas only (billing guard); verified live with P12 and P01
- [x] Results stored as provider facts with synthetic association; non-blocking reviewer note; recommendation unaffected
- [ ] Optional: Fraud Finder risk score (`POST /fraud-finder/fraud-finder`)

## Phase 5: Regulatory considerations
- [x] Curated source list with kinds, URLs, review dates, and applicability conditions
- [x] Scenario-scoped considerations, no deadline calculation
- [ ] Verify the paraphrased excerpts word for word (1005.6, 1005.11, CFPB FAQ)

## Phase 6: Reviewed improvements and mock payout
- [~] Automatic approval policy AUTO-1 v2 (approve-only, ≤ $100, 14 checks including payment origin, merchant history, refunds, a required CRS identity check and a Fraud Finder score of 30 or less; Fraud Finder verified live on P01) with a SIMULATED Nessie deposit that can be paid only once (2026-10-24; mock-tested; first live deposit not yet made)
- ~~Factory Droid task on recorded failures~~ dropped (decided 2026-10-24)
- [ ] Human approval and reversal of claims outside AUTO-1 (the panel shows failing checks; no approve or reverse button yet)

## Next smallest milestone
Voice: configure the Cartesia Managed Agent and webhook tool against the cloud deployment,
then build the browser call client (agent WebSocket and microphone).
