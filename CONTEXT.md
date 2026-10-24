# CONTEXT.md: current project state

> Living summary of where the project stands. **Update it on every prompt that changes anything**: change
> the sections below and add an entry to the revision log at the bottom.
> New agent? Start with `docs/agent-handoff.md` (self-contained briefing).
> Details live in `docs/status.md` (checklist), `docs/integrations.md` (verified provider
> facts), `docs/architecture.md` (design), `docs/claim-intake-design.md` (product design and
> decisions), and `CLAUDE.md` (rules).

_Last updated: 2026-10-24 (intake questions tailored to automatic approval)_

## What this is

A hackathon prototype of a **voice-assisted fraud-claim intake system** for U.S. consumer bank
accounts. **Consumers file claims, and the software is an extension of their bank.**

1. A customer reports a suspicious payment, by voice (Cartesia agent, `/call` page or case page)
   or by text.
2. Bitdeer extracts the facts, and the backend asks one question at a time.
3. The claim is matched against live (mock) Nessie bank records.
4. It is checked against evidence: payment origin, merchant history, refunds, a CRS identity
   check and CRS Fraud Finder.
5. A small claim that passes every check is **approved automatically and paid as a SIMULATED
   Nessie deposit**. Everything else goes to a person.

Rules that always hold:
- All data is synthetic, and the money is simulated.
- **Approve-only automation.** Policy AUTO-1 (`lib/domain/autoApproval.ts`) may approve claims of $100 or
  less. The app **never denies**; denials are always made by a person.
- No legal determinations. Credit and criminal data are never used to judge claims.

## Current state at a glance

| Area | State |
|---|---|
| Web app (Next.js 16) | ✅ Staff dashboard `/`, case page `/cases/<id>`, customer call page `/call`, **bank claims workstation `/review`** (queue + investigation workspace) and **synthetic guided-intake demo `/review/demo`** (merged from `bank-dashboard` 2026-10-24). The workstation does not yet show AUTO-1 results or payouts; use the case page for those |
| Backend (Convex) | ✅ Cloud dev deployment `dev:dynamic-chihuahua-120`. **Latest code is deployed** (pushed with `npx convex dev --once`) |
| Bank records (Nessie) | ✅ Live: purchases **and deposits** (deposits drive the refund check; never matched as the disputed payment) |
| Extraction (Bitdeer) | ✅ Live on dev: `zai-org/GLM-5.3-Flash`, 4–8 s per statement. ⚠️ **Credits not approved ($0.00 balance); may be refused at any moment.** Refusals show on the case. Off switch: `npx convex env set REASONING_PROVIDER scripted` |
| Voice (Cartesia) | ✅ Live: one question per turn (`question_id`), **tailored to what AUTO-1 needs** (mostly a yes or no about one named bank record); waits up to 8 s for extraction; at most one "anything else?" in a row; a display error can't end a call |
| CRS | ✅ Identity check and **Fraud Finder** live (persona bodies only; Fraud Finder verified on P01, score 11) |
| Automatic reimbursement | ✅ Built: AUTO-1 v2, 14 checks, SIMULATED deposit that can't be paid twice. ⚠️ **The first live deposit hasn't been made yet** |
| Payment-origin records | ✅ SYNTHETIC presets per transaction (case page dropdown) |
| Login / access control | ❌ None: every Convex function is public (synthetic data only) |
| Factory Droid | ❌ Not started |
| Checks | ✅ `npm run verify` (with the `bank-dashboard` merge): typecheck, lint, **152 tests**, build pass |

## Branch and git

- Branch `foundation`. **Local commits are not pushed** (see `git log origin/foundation..foundation`). Push only when the user asks.
- `legislative-reference/` is untracked and must stay uncommitted (the user didn't recognise it).
- Commit as `maximozhang <145702814+maximozhang@users.noreply.github.com>`.

## Demo plan (user decisions)

- A **prepared bank record and script**. The customer is framed as already logged in to their bank, so
  **no automatic bank-record pull** when a call starts.
- **Run-through for an automatic approval:**
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

1. **A full demo rehearsal on dev**, including the **first live SIMULATED deposit**. The code follows
   Nessie's spec (`medium: "balance"`, `status: "completed"`, integer amount), but nothing has run live
   yet. A rejection shows on the case, with Retry payout.
2. **A voice re-test with Bitdeer on**, including the new tailored questions (not yet heard live). Check the pacing with the 8 s wait, and that varied acknowledgements
   follow the updated agent instructions (paste them from `docs/integrations.md` into the Cartesia Playground).
3. **Buttons for a person:** approve or reverse claims outside AUTO-1. Today only the checklist is shown.
4. **Login and access control** before any non-synthetic use (Convex Auth now, bank SSO later; decided).
5. **The redesign phases** in `docs/claim-intake-design.md`: per-payment fact model, screening results,
   disputes and recovery events, deadline estimates, documents.
6. **Regulatory:** verify the 1005.6 and 1005.11 excerpts word for word (the CFPB FAQ excerpt is done).
7. **Factory Droid loop.**

## Claims workstation (`/review`, merged from `bank-dashboard`)

- **Queue** `/review`: cases grouped by who acts, search, filter, keyboard selection, blocked marker; read-only
  `review:queue` query and pure `lib/domain/triage.ts`.
- **Case workspace** `/review/<id>`: case brief (Reported / Observed / Inferred / Recommended), how the intake
  progressed (each reply with the question it answered), payments and evidence with reconciliation states,
  findings (supported / missing / conflicting / superseded), decision trace, prepared-output states, filterable
  timeline. View models in `lib/review/`. Only live action: Retrieve bank records.
- **Demo** `/review/demo`: scripted fixtures run through the real rules in the browser; two branches; demo-only
  review controls labelled "demo, not saved". No AI, Convex or Nessie calls.
- Not yet in the workstation: AUTO-1 checklist, payout state, payment-origin presets, Fraud Finder. Its wording
  still says "a person decides", which predates AUTO-1.

## Known limitations

- Extraction takes 4–8 s, longer than ideal for voice. Bitdeer ignores both thinking-off parameters tried.
- Payment-origin data is SYNTHETIC: Nessie has no device or login records.
- CRS checks the *person* (identity, contact-detail risk), not whether a payment was authorized.
- Spoken digits ("four eight two…") aren't redacted; only digit strings next to a keyword are.
- The 3-minute call cap stays (decided), so intake may need a second call or text.

## Waiting on the user

- **Bitdeer credits:** manual CalHacks approval pending.
- **Cartesia:** paste the updated agent instructions; check the retention settings so audio isn't kept;
  lower the inactivity timeout. Balance about $0.86 before the promo code.
- **Housekeeping:** rotate the CRS password (it was pasted in chat once). Push `foundation` when ready.
- **Factory:** API key and `droid` CLI, when we reach that step.

## How to run

```
npx convex dev             # backend (cloud dev deployment)
npm run dev                # http://localhost:3000
npm run verify             # all checks
npm run live:reasoning     # Bitdeer check (spends credits; keep rare)
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
