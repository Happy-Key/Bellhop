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
- [~] Cartesia webhook-tool endpoint (tested locally over HTTP; not yet called by Cartesia)
- [~] Cartesia access-token minting (not run live)
- [ ] Browser call client (agent WebSocket, microphone audio)
- [x] Webhook tool registration: `voiceSetup:registerVoiceTool` (idempotent; mock-tested; run live by the user 2026-10-24, tool created and attached)
- [~] Managed Agent instructions pasted into the Playground (welcome message and the rest of the prompt not done yet)
- [x] First live call (Playground preview, 2026-10-24): `session_token` dynamic variable → webhook tool → Convex → dashboard
- [ ] Enable the `end_call` system tool and lower the inactivity timeout
- [~] OpenAI-compatible live reasoning provider (mock-tested; Bitdeer credits not claimed)

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
- [ ] Factory Droid task on recorded failures (worktree, `--auto low`, visible diff and tests, human merge)
- [ ] Simulated reimbursement via Nessie deposit: explicit human approval, idempotent, labelled SIMULATED

## Next smallest milestone
Voice: configure the Cartesia Managed Agent and webhook tool against the cloud deployment,
then build the browser call client (agent WebSocket and microphone).
