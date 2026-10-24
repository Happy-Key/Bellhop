# CONTEXT.md: current project state

> Living summary of where the project stands. **Update it on every prompt that changes anything**: change
> the sections below and add an entry to the revision log at the bottom.
> New agent? Start with `docs/agent-handoff.md` (self-contained briefing).
> Details live in `docs/status.md` (checklist), `docs/integrations.md` (verified provider
> facts), `docs/architecture.md` (design), `docs/claim-intake-design.md` (product design and
> decisions), and `CLAUDE.md` (rules).

_Last updated: 2026-10-24 (legislative reference registry wired into the model's investigation)_

## What this is

A hackathon prototype of a **voice-assisted fraud-claim intake system** for U.S. consumer bank
accounts. **Consumers file claims, and the software is an extension of their bank.**

1. A customer reports a suspicious payment, by voice (Cartesia agent, `/call` page or case page)
   or by text.
2. Bitdeer extracts the facts, then reassesses the whole case: what is established, what is uncertain, which
   investigative work matters, and the next question (asked one at a time; the fixed rules are the fallback).
3. The claim is matched against live (mock) Nessie bank records.
4. It is checked against evidence: payment origin, merchant history, refunds, a CRS identity
   check and CRS Fraud Finder.
5. A small claim that passes every check is **approved automatically and paid as a SIMULATED
   Nessie deposit**. Everything else goes to a person.

Rules that always hold:
- All data is synthetic, and the money is simulated.
- **Approve-only automation.** Policy AUTO-1 (`lib/domain/autoApproval.ts`) may approve claims of $100 or
  less. The reasoning model (Bitdeer) may also **propose** approvals and denials; a person confirms denials
  and any approval AUTO-1 doesn't cover. The app never denies on its own.
- No legal determinations. Credit and criminal data are never used to judge claims.

## Current state at a glance

| Area | State |
|---|---|
| Web app (Next.js 16) | ✅ Staff dashboard `/`, case page `/cases/<id>`, customer call page `/call` (with a **demo persona picker**), **bank claims workstation `/review`** (queue grouped by who acts + conclusion-first case workspace with a collapsed decision record, including AUTO-1 checks and payouts) and **pitch demo `/review/demo`** (five-act scripted replay; rebuilt 2026-10-24) |
| Case control | ✅ **Delete** on the developer tab `/` (`cases.remove`: the case and every row recorded for it, batched for big cases; payment origins and Nessie records stay; late writes from in-flight work are dropped). **Call back** on `/call`: "An existing case" continues any case (DEMO ONLY, no logins) |
| Backend (Convex) | ✅ Cloud dev deployment `dev:dynamic-chihuahua-120`. ⚠️ **Two `npx convex dev` watchers are running** on the dev machine and push every saved change, so dev tracks the working copy (including uncommitted work), not a chosen commit. With `REASONING_PROVIDER=openai-compatible` and `CASE_REASONING` unset, **Bitdeer whole-case decisions are ON on dev**. Env `NESSIE_PERSONA_ACCOUNTS` set. Those watchers aren't on this machine. **This machine** runs one `npx convex dev` watcher (since 07:23) against the personal review deployment `friendly-grouse-183` (no Bitdeer key, so the rule fallback shows there); it already has the investigation restructure |
| Bank records (Nessie) | ✅ Live: purchases **and deposits** (deposits drive the refund check; never matched as the disputed payment) |
| Extraction (Bitdeer) | ✅ Live on dev: `zai-org/GLM-5.3-Flash`, 4–8 s per statement. ✅ **CalHacks promo active** (2026-10-24, per user); the $0.00 balance shown is a Bitdeer display bug. Refusals show on the case. Off switch: `npx convex env set REASONING_PROVIDER scripted` |
| Voice (Cartesia) | ✅ Live: one question per turn (`question_id`); waits up to 8 s for extraction, then (with case reasoning on) up to 12 s in total for the model's reassessment, which **chooses the next question**; otherwise the rule question (tailored to what AUTO-1 needs) is used and logged. At most one "anything else?" in a row; a display error can't end a call. The model-chosen questions haven't been heard live yet |
| CRS | ✅ Identity check and **Fraud Finder** live (persona bodies only; Fraud Finder verified on P01, score 11) |
| Case investigation (Bitdeer) | 🟡 **Built, mock-tested, not run live.** The model reassesses each case whenever it changes: findings (reported / corroborated), hypotheses, uncertainties, the work items it chooses, the next question, and a proposed disposition (approve / deny / request information / escalate) with cited reasons, legal reading and drafts. It plans against the **reference rule registry** from `legislative-reference/` (index of all case rules + detail for the claim type it leans towards) and records `rulesConsulted`. Every assessment is kept with a code-computed diff. Info requests and escalations are automatic; approvals pay out automatically only if AUTO-1 passes, otherwise a person approves in `/review/<id>`; denials always need a person. Rules = guardrail + labelled fallback. Off switch: `CASE_REASONING=off`. The personal review deployment has no Bitdeer key (rule fallback shown) |
| Automatic reimbursement | ✅ Built: AUTO-1 v2, 14 checks, SIMULATED deposit that can't be paid twice. ✅ **First live deposit made** 2026-10-24 (persona Margaret, $58, Nessie deposit `96ead8f0…`) |
| Payment-origin records | ✅ SYNTHETIC presets per transaction (case page dropdown); persona cases attach their own automatically |
| Demo personas | ✅ `/call` picker: Margaret (P01, auto-approve), Grace (P19, own device → person), Victor (P12, identity fail → person), Samuel (P16, scam → specialist). Each has its own seeded Nessie account; its case sets itself up. Margaret verified live end to end. Committed and pushed (rebased onto `936dea4`) |
| Login / access control | ❌ None: every Convex function is public (synthetic data only) |
| Factory Droid | ❌ Not started |
| Checks | ✅ `npm run verify`: typecheck, lint, **195 tests**, build pass |

## Branch and git

- Branch `foundation`. Local `foundation` = `origin/foundation` (personas, case control, promo note, legislative pack)
  merged with the investigation-restructure commit `1c38656`. **Not pushed** (see `git log origin/foundation..foundation`).
  Push only when the user asks.
- `legislative-reference/` (research pack: Overview.md and the rule-registry CSV) is committed (user approved, 2026-10-24).
- Commit as `maximozhang <145702814+maximozhang@users.noreply.github.com>`.

## Demo plan (user decisions)

- **Demo personas on `/call`** (decided 2026-10-24). Pick one before starting the call. Each persona is hardwired to
  its own seeded Nessie account (`NESSIE_PERSONA_ACCOUNTS`), a CRS test identity and payment-origin records per
  purchase (`lib/fixtures/demoPersonas.ts`). Its case **sets itself up**: records retrieved, origins attached, CRS
  identity check and Fraud Finder run (`convex/personaSetup.ts`). The presenter notes on the page show the
  ledger, expected outcome and suggested lines. Say the amount and merchant (purchase dates are fixed at the seed
  date). Re-seed with `npm run seed:personas -- --confirm [--only=<id>]`, then update the env var.
- **No persona** = the old behaviour: a prepared bank record and script, the customer framed as already logged
  in, and **no automatic bank-record pull** when a call starts.
- Bitdeer tags a plain denial ("a charge I didn't make") as a scam indicator, so AUTO-1 waits for the
  credentials answer: always say the "No, I never gave anyone a code…" line.
- **Manual run-through (no persona) for an automatic approval:**
  1. Open the case page and click **Retrieve bank records**.
  2. Set the demo payment's "How it was made" to **New device, no two-factor, out of state**.
  3. Link persona **P01** (or P19) and click **Run CRS checks**.
  4. Make the claim.
  - Section 5 should show 14 passes and an automatic approval, followed by a SIMULATED deposit.
- **The demo payment must be under $100**, at a merchant with **no other payments** on the account (the two
  Corner Grocer purchases block each other). The script must state the **exact amount** and the merchant or date.
- Payment-origin records belong to the Nessie transaction, not the case: set once, and later cases reuse it.
- For a "false claim" demo, choose **Customer's own device, two-factor passed**: the claim goes to a person.

## What needs to be done next (priority order)

1. **A full voice rehearsal of each persona** on dev. Margaret was verified end to end by text (setup, Bitdeer,
   14 checks, SIMULATED deposit); Grace, Victor and Samuel are verified offline only (`tests/personas.test.ts`).
   Consider fixing the Bitdeer prompt so a plain denial isn't a scam indicator.
2. **A voice re-test with Bitdeer on**, including the model-chosen questions (not yet heard live). Check the pacing:
   extraction plus reassessment must fit the 12 s webhook budget, otherwise the rule question is used (look for
   `rule_question_fallback` in the activity log). Also check that varied acknowledgements follow the updated agent
   instructions (paste them from `docs/integrations.md` into the Cartesia Playground).
3. **More reviewer actions:** persist override and return-to-agent, and let a person reverse a flagged approval.
   Approving or confirming a model proposal already works in `/review/<id>`.
4. **Login and access control** before any non-synthetic use (Convex Auth now, bank SSO later; decided).
5. **The redesign phases** in `docs/claim-intake-design.md`: per-payment fact model, screening results,
   disputes and recovery events, deadline estimates, documents.
6. **Regulatory:** verify the 1005.6 and 1005.11 excerpts word for word (the CFPB FAQ excerpt is done).
7. **Factory Droid loop.**

## Claims workstation (`/review`)

- **Queue** `/review`: groups Needs a bank reviewer / Waiting on the customer / Investigating / No report yet / Decided;
  rows show the active work item, any proposal and blockers; search, filter, keyboard selection. Read-only
  `review:queue` query; view model `lib/review/caseStatus.ts`.
- **Case workspace** `/review/<id>` (rebuilt conclusion-first 2026-10-24): **What happened** (model summary or the
  customer's words, payment, status, blockers) → **Investigation** (work items, active first) → **Established and
  open** (findings reported/corroborated, uncertainties, hypotheses) → collapsed **Decision record** (evidence;
  rules, policies, AUTO-1 checks and the rule trace; how the assessment changed; conversation; documents; activity).
  Right column: authorized outcome, proposed disposition with the computed amount and authorize controls, next step,
  "Reassess now". Evidence links open the collapsed section that holds the source. Without a model assessment the
  investigation is the labelled rule-based fallback.
- **Demo** `/review/demo`: a five-act pitch (problem → conversation → the answer that changes the interpretation →
  finished case → a person decides). The customer's lines and the model's outputs are a scripted replay
  (`lib/fixtures/pitchDemo.ts`); the match, rule fallback, proposal validator, execution plan and AUTO-1 run on it
  for real (`lib/review/pitchDemo.ts`). No AI, Convex or Nessie calls; buttons say "Demo, not saved". The old
  guided-intake walkthrough lives only as a test fixture (`tests/helpers/`).
- Not yet in the workstation: payment-origin presets, CRS controls, persona setup (use `/cases/<id>` and `/call`).
  Override and return-to-agent are not persisted.

## Case investigation and decisions by the reasoning model (user decisions 2026-10-24)

- Bitdeer is the reasoning model; no Claude API. Not every decision needs a person; the model may propose denials.
- The model reassesses each case whenever it changes (a statement, no pending interpretation, bank records in) and
  maintains the investigation; code validates it, computes amounts and records a diff per assessment.
- Files: `lib/domain/investigation.ts` (investigation schema, validation, diff, rule fallback), `lib/domain/caseDecision.ts`
  (proposal schema, input, validation, who acts), `convex/proposals.ts` (stores every assessment + `changeLog`),
  `convex/caseReasoning.ts` (Bitdeer call), `lib/review/caseStatus.ts`, `components/review/CaseInvestigation.tsx` and
  `CaseDecision.tsx` (disposition panel).
- The voice agent asks the model's current question first; the webhook waits for the reassessment (12 s total budget).
  If none is ready, the rule question is used and logged `rule_question_fallback` (same 2-per-call limit).
- Route wording in `workflow.ts` / `triage.ts` updated (no rule changes). Stored analyses keep the old text until their next recompute.
- To try it live: on a deployment with the Bitdeer env vars (shared dev has them), submit a statement (the model reassesses automatically) or press
  "Reassess now". The Bitdeer promo is active (its $0.00 balance display is a bug).

## Known limitations

- Extraction takes 4–8 s, longer than ideal for voice, and the case reassessment adds another model call per
  case change. Bitdeer ignores both thinking-off parameters tried.
- Payment-origin data is SYNTHETIC: Nessie has no device or login records.
- CRS checks the *person* (identity, contact-detail risk), not whether a payment was authorized.
- Spoken digits ("four eight two…") aren't redacted; only digit strings next to a keyword are.
- The 3-minute call cap stays (decided), so intake may need a second call or text.

## Waiting on the user

- **Dev watchers / case reasoning:** decide whether to stop the `npx convex dev` watchers (dev then stays on a chosen commit) and whether case reasoning (`CASE_REASONING`) should stay on for dev.

- **Cartesia:** paste the updated agent instructions; check the retention settings so audio isn't kept;
  lower the inactivity timeout. Balance about $0.86 before the promo code.
- **Housekeeping:** rotate the CRS password (it was pasted in chat once). Push `foundation` when ready.
- **Factory:** API key and `droid` CLI, when we reach that step.

## How to run

```
npx convex dev             # backend (cloud dev deployment)
npm run dev                # http://localhost:3000
npm run verify             # all checks
npm run live:reasoning     # Bitdeer check (live; promo credits)
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
| 2026-10-24 | Added a test that a payment missing from the Nessie records, or a case whose records were never retrieved, is never approved automatically (it goes to a person) |
| 2026-10-24 | **Verification against evidence (AUTO-1 v2, user chose all four):** SYNTHETIC payment-origin records (case page presets); Nessie deposits retrieved (refund check; never matched as the disputed payment); merchant-history check; CRS identity check now *required*; **CRS Fraud Finder implemented and verified live** (P01 score 11, low). Persona bodies checked byte-for-byte against CRS's file. 121 tests pass. Signals only stop automatic approval, never deny |
| 2026-10-24 | **Automatic reimbursement:** user approved approve-only automation, a $100 limit and a SIMULATED Nessie deposit. Added policy AUTO-1 (`lib/domain/autoApproval.ts`, 10 checks), the `reimbursementDecisions` table, `convex/payout.ts` (deposit made at most once via `depositOnce`) and `payoutData.ts` (record, retry), case page section 5, and CLAUDE.md rules. 115 tests pass. No live deposit made yet |
| 2026-10-24 | Voice call with Bitdeer on: every turn was "anything more you'd like to add?" and no question was asked (Bitdeer took 4.7–7.0 s vs the 4.5 s wait, including for "No, I'm done."). Fixed: default wait 8 s; short or rule-read replies don't wait; at most one acknowledgement in a row. Model findings re-keyed `S<n>-M<i>`, fixing the duplicate React keys F1/F2 on the case page; the table key also includes the index for old analyses. Bitdeer ignores both thinking-off parameters tried. Agent instructions: vary acknowledgements |
| 2026-10-24 | **Bitdeer integration resumed and enabled on dev.** Key works ($0.00 balance; credits pending, so requests may start failing). Compared 4 models; chose `zai-org/GLM-5.3-Flash` (4–8 s typical). Prompt fixes: extract only from the current statement, short labels, "bank" isn't a merchant, being asked isn't sharing. Over-long labels are shortened, not rejected. Provider errors keep their reason. A failed interpretation no longer stalls a voice call. Code pushed to dev (`convex dev --once`), `REASONING_*` env set, verified end to end. User declined auto-retrieval of bank records (demo plan) |
| 2026-10-24 | Diagnosed the "first statement not saved" report from the activity log and Convex logs. Call 1 (case `…8gxj8w`, 14:34Z) was bound, but **no tool request ever reached the backend**: the display crash unmounted `VoiceCall`, whose cleanup hung up before the agent saved anything. Call 2 (case `…8gxfs6`) saved S1 normally. Added `CallDisplayBoundary` so a display error can't end a call again. Also found: `/call` cases never retrieve bank records (stage stays `retrieve_evidence`); S1 "I do not believe I authorized it" was read as `authorized` by the scripted extractor, so the agent asked the scam follow-up (pinned for Bitdeer) |
| 2026-10-24 | Live test after Convex push: browser errors on the customer call view ("useEffect must not return anything…", then "destroy is not a function" ×2). Cause: the transcript auto-scroll effect in `components/VoiceCall.tsx` returned `scrollIntoView()`'s value (a Promise in current browsers). Fixed with a block body; verify passes |
| 2026-10-24 | Pulled merged `foundation` (`ff904d8`, includes `client-view`); handoff commit rebased on top. `npm run verify` passes on the merged tree (100 tests; build includes `/call`). Local `.env.local` targets `dev:dynamic-chihuahua-120` |
| 2026-10-24 | `docs/agent-handoff.md` added: briefing for other LLMs/agents (rules, branch state, API changes, decisions, pending actions). Dry-run merge of `origin/client-view` into `foundation`: no conflicts |
| 2026-10-24 | Bitdeer integration paused by the user (nothing configured; scripted mode). `foundation` pushed so another agent's frontend changes can merge |
| 2026-10-24 | **Bitdeer reinstated** as the extraction provider (user reversed the removal). Docs re-checked; the model now gets the question being answered; `npm run live:reasoning` check script added; integration steps in `docs/integrations.md` |
| 2026-10-24 | Decisions on the 13 questions recorded. CLAUDE.md scope widened; Bitdeer removed from docs and code comments; CFPB FAQ excerpt in `regulatory.ts` replaced with word-for-word quotes (user-approved); Nessie deposits read probe (200, empty); consent and AI notice added to the agent instructions |
| 2026-10-24 | Backend consistency fixes: question keys, audience and priority; answers linked to questions; `question_id` voice flow; no-repeat; stale-attempt guard; bounded interpretation wait; redaction on ingest; append-only evidence; correction targeting; spoken amounts; action-based initiation question. 99 tests pass; not pushed or run live |
| 2026-10-24 | Design proposal `docs/claim-intake-design.md`: fact model, adaptive voice intake, reimbursement and legal-review screens, rule registry, phased plan. No code changed; Reg E 1005.6(b), 1005.11 and CFPB EFT FAQs re-checked live. Awaiting decisions in its section I |
| 2026-10-24 | **Live browser voice call worked** (call-ID binding confirmed: `system__conversation_id` = `session_ready.call_id`); End call works; $0.05. Logged issues: spoken amounts and cents missed, answers lack the agent's question, agent repeats itself, voice corrections unlinked |
| 2026-10-24 | Branch `client-view` (off `foundation` `f9bb26a`): customer-only call page `/call`, route-aware banner (`components/SiteBanner.tsx`), `VoiceCall` gains `variant` + lazy case resolver. Committed and pushed to `origin/client-view`; `npm run verify` passes (74 tests, build includes `/call`) |
| 2026-10-24 | Separate personal Convex dev deployment for `client-view` review (user-created; own keys). `VOICE_TOOL_SECRET` generated and set there; `record_statement` tool registered live on a new, separate Cartesia agent |
| 2026-10-24 | Merged `client-view` into `foundation` (no conflicts); `npm run verify` passes on the merge (100 tests) |
| 2026-10-24 | End-of-session refresh before a context reset: status sections rewritten (approve-only automation, Bitdeer live, CRS Fraud Finder, AUTO-1 v2, demo run-through, next steps, known limitations); 122 tests. Revision log unchanged |
| 2026-10-24 | Workstation rebuilt as an evidence-linked investigation workspace plus the synthetic guided-intake demo `/review/demo` (branch `bank-dashboard`, commit `0a59fbd`; 15 new tests) |
| 2026-10-24 | Merged `bank-dashboard` into `foundation` (only conflict: CONTEXT.md, resolved by keeping foundation's rewrite and adding the workstation section) |
| 2026-10-24 | Switching the working copy to `foundation` means the running `npx convex dev` watcher pushes foundation's schema and functions (AUTO-1, payouts, payment origins) to the personal review deployment `friendly-grouse-183`. It has no Bitdeer key, so extraction there stays scripted |
| 2026-10-24 | **Intake questions tailored to automatic approval (AUTO-1).** Fixed four ways a legitimate claim got stuck: (1) two amounts in one statement blocked the claim for good (the question returned after being answered, and the reply created an amount conflict); it now confirms the one matched record by name. (2) "They asked for a code but I didn't give it" was read as *shared*; the question now asks what the customer *gave*, and refusals parse as not shared. (3) "No." / "I don't recognize it" in reply to "did you make it?" didn't parse; now read as someone else. (4) Missing details were one three-part question; now one at a time, exact amount (with cents) first, skipping a detail the customer doesn't know. Also: two possible records → yes/no about the likelier one ("no" leaves the other as the match); the initiation question names the matched payment; "I sent it" read from a free-form account gets one read-back (`confirm:authorization`) so a misread denial isn't lost; replies to which-payment questions that restate the amount or date supersede the earlier value (`settles()` in `lib/domain/facts.ts`). `autoApproval.ts` unchanged. 8 new tests. Rebased onto the `bank-dashboard` merge (`e8f06d2`); its triage and guided-intake demo tests updated to the new key (`tentative:<ref>` for two possible records) and the named initiation question. 152 tests pass. Pushed to `origin/foundation`; not run live; not pushed to Convex |
| 2026-10-24 | Bitdeer whole-case decision proposals (user decision: Bitdeer, no Claude API; model may propose denials; not every decision needs a person). New `caseProposals` table and `approved_by_person` outcome; voice uses the model's question as a fallback; decision panel in `/review/<id>`; `CLAUDE.md` updated. 11 new tests (155 total); verify passes. Not run live. Committed and pushed to `foundation`, merged with the intake-question commit `c858e1b`. The running `convex dev` watcher pushed the new functions to `friendly-grouse-183` (scripted there, so no model calls) |
| 2026-10-24 | Pushed `foundation` `c858e1b` (tailored questions plus the `bank-dashboard` workstation) to the main dev deployment `dynamic-chihuahua-120` with `npx convex dev --once`; `review:queue` is registered there |
| 2026-10-24 | **Demo personas on `/call`** (user decisions: full automatic setup for personas, none without one; four scenarios; seeding approved). `lib/fixtures/demoPersonas.ts` (Margaret/P01, Grace/P19, Victor/P12, Samuel/P16, each with merchants, purchases, per-purchase SYNTHETIC origins, expected outcome and script); `convex/personas.ts` (`createForPersona`: the backend maps persona → account via `NESSIE_PERSONA_ACCOUNTS`, never from the client; origins attached on retrieval without overwriting); `convex/personaSetup.ts` (retrieve → CRS identity → Fraud Finder); the Nessie and CRS action bodies became shared helpers; `cases.demoPersonaId`; persona home state used for AUTO-1; `/call` picker with presenter notes, locked during a call; `npm run seed:personas` (shared seed helpers). Seeded all four in the Nessie sandbox (read-back verified), set the env var, deployed. **Live check (Margaret, by text):** setup 3 records + 3 origins + CRS clean + score 11; Bitdeer read S1 correctly but tagged it as a scam indicator; after the credentials line, all 14 checks passed and **the first live SIMULATED deposit** went through ($58). 159 tests pass (7 new). Not committed |
| 2026-10-24 | User couldn't click other personas on `/call`. Not reproduced: in headless Chrome the picker switches personas, and it unlocks after a failed call start; likely a stale tab, a Next.js error overlay, or the deliberate lock during a call. Removed the CRS-persona import from `lib/fixtures/demoPersonas.ts` so the browser bundle no longer carries CRS test identity bodies (check kept in `tests/personas.test.ts`); redeployed |
| 2026-10-24 | **Case control.** Developer tab `/` gets a Delete button per case (confirm dialog). `cases.remove` deletes the case row first, then every row with its `caseId` in statements, transactions, providerEvidence, activity, processedEvents, reimbursementDecisions, caseProposals, intakeTurns and voiceSessions (new `by_case` indexes on the last three), 500 per table per mutation, continuing in `cases.purgeRemainingRows`. Payment origins (keyed by Nessie transaction) and Nessie records (including SIMULATED deposits) stay. `logActivity` skips a removed case, and other late writes fail and roll back, so in-flight work leaves no orphans. `/call` gets "A new report" / "An existing case": pick any case (persona, time, stage, questions waiting) and the call continues it; `cases.list` returns persona, recommendation and open customer questions. 4 new Convex tests; checked in headless Chrome against dev (create → delete; callback picker). Found two running `npx convex dev` watchers auto-pushing to dev (so this work is already on dev) and Bitdeer case reasoning ON there; left both alone per the user. 174 tests pass. Not committed |
| 2026-10-24 | **Bitdeer promo active** (user): the $0.00 balance on Bitdeer's dashboard is a display bug, not missing credits. Status rows and "waiting on the user" updated |
| 2026-10-24 | **Demo rebuilt as a pitch** (`/review/demo`, from the user's revision brief): five short acts led by the value statement; one scripted scenario (an unfamiliar $49 gift-card payment; the customer reveals a bank impersonator told them to buy it; the agent revises its interpretation and asks about the card PIN; the proposal is escalate to the scam specialist). Model outputs are labelled as a scripted replay; the guardrails run for real. Removed the old walkthrough UI and its demo-only workspace plumbing (snapshots, banner, demo review controls); its scenario moved to `tests/helpers/` for the view tests. `npm run verify` passes, 165 tests |
| 2026-10-24 | **The model's investigation drives the workflow** (user's restructuring brief). New `lib/domain/investigation.ts`: the model's findings (reported/corroborated), hypotheses, uncertainties, work items and change notes, with validation (unknown refs dropped, uncorroborated findings downgraded, all listed), a code-computed diff, and a labelled rule-based fallback. Case reasoning now runs on every case-state change (not only at decision points) and gets the previous assessment; `missingInformation` replaced by `investigation`; `caseProposals.changeLog` added (optional field). Voice asks the model's question first, waiting up to 12 s total; rule question is the logged fallback. New `lib/review/caseStatus.ts` (who acts, headline, disposition, authorized outcome). Workspace rebuilt conclusion-first with a collapsed decision record; queue regrouped (reviewer / customer / investigating / no report / decided). Pitch demo shows the planned work changing. Removed NextSteps, ReviewControls and the case brief. Docs: CLAUDE.md, architecture, integrations. 180 tests pass. Not run against live Bitdeer |
| 2026-10-24 | Committed the pitch demo and investigation restructure (`1c38656`) and merged `origin/foundation` (personas, case control, promo, legislative pack). Only conflict: this file, consolidated (remote facts kept: first live deposit, personas, promo, watchers, legislative pack committed; duplicate intake-questions log row removed). 191 tests pass on the merge. Not pushed |
| 2026-10-24 | **Legislative reference pack wired into the model** (user: use it as data/reference for what each fraud category needs). It was already committed (came in with the `origin/foundation` merge; not gitignored). New `lib/domain/ruleRegistry.ts` (CSV parser, claim-lean selection), generated `ruleRegistryData.ts` (`npm run build:rules`, drift test). Case reasoning input gets `referenceRules` (index of 31 case rules + detail for the lean: unknown 15, unauthorized 22, scam 16; wires/checks/brokerage index-only; ~20–25 KB); the prompt says reference only, never evidence or deadlines; model returns `investigation.rulesConsulted`, unknown IDs dropped; shown in the decision record. Fact IDs F01–F42 undefined in the repo (asked the user). 4 new tests, 195 pass. Not run live |
