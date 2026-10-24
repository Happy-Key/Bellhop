# Claim suite experiment: notes for porting

Written 2026-10-24 so this work can be carried to another branch (e.g. the frontend overhaul) later.
The work lives on `foundation` in three commits on top of `5097cd3`:

| Commit | What |
|---|---|
| `c28ef4e` | 17-persona claim suite, live suite runner (`/review/suite`), `npm run reset:convex` |
| `8817abf` | Fast Bitdeer case reasoning (`REASONING_EFFORT=low`), transient retry, lenient parsing, fairer verdicts |
| `1a7814c` | Double-payment guard (AUTO-1 v3), reset that restores the Nessie seeds, dynamic customers, question tied to the plan |

To port everything: `git cherry-pick c28ef4e 8817abf 1a7814c` (expect conflicts in UI files if the other
branch rewrote `/review` and `/call`; the backend and `lib/` pieces are mostly self-contained). To port
selectively, use the per-feature file lists below.

---

## 1. Findings that matter regardless of the UI

These are product bugs or risks the suite found. Several are worth porting even if nothing else is.

1. **Bitdeer case reasoning never finished.** GLM-5.3-Flash spent 8–9k reasoning tokens on the whole-case
   prompt (~36k chars) and took 50–110 s; every call timed out at 60 s, so the model never proposed
   anything. `reasoning_effort: "low"` brings it to 12–16 s (18–162 reasoning tokens) with valid proposals.
   `thinking: {type: "disabled"}` and `chat_template_kwargs.enable_thinking=false` did *not* help on this
   prompt. Other models without the setting: DeepSeek-V4-Flash 42 s, V4.1-Flash 53 s, GLM-5.3 102 s,
   Qwen3.8-27B 137 s. → `REASONING_EFFORT` env var, sent as `reasoning_effort` (both calls).
   **Any deployment using case reasoning needs `npx convex env set REASONING_EFFORT low`.**
2. **Double payment.** AUTO-1's refund check ignores our own payout deposits (correctly, they aren't refunds),
   so a second claim on an already-reimbursed payment was approved and paid again (seen live twice).
   → AUTO-1 v3 check `not_already_reimbursed` (user-approved), and the same check blocks person approvals.
3. **Family / shared access auto-approved.** "I never gave anyone a code, but my brother knows my laptop
   password" was read as *not shared* by both the scripted extractor and Bitdeer, so a $38 claim was paid
   automatically. → extraction prompt and scripted patterns now count shared access as sharing.
4. **Approximate amount raised a false contradiction.** "About forty dollars" then "the $42 one" became an
   amount conflict that blocked the case. → the extraction prompt leaves approximate amounts out.
5. **Rule question loop.** "Which single payment are you disputing?" was asked five times in a row: the key
   was `multiple_amounts:<statementRef>`, so each reply that again named several amounts made a new key and
   bypassed the twice-per-call limit. Would loop on a voice call too. → stable key `multiple_amounts`.
6. **Misread short reply.** "Yes, I did it myself. … the caller told me to" was read as "someone else" (the
   word "caller"), creating a false contradiction and a repeated question. → a reply that *opens* with the
   customer doing it is read as theirs unless it says "someone else" (`lib/domain/answers.ts`).
7. **The model rarely chose the question.** Extraction (5–10 s) plus reassessment (12–16 s) missed the
   16 s per-turn budget, so text chats mostly got rule questions. → text chats wait up to 30 s / 45 s;
   voice keeps 12 s / 16 s (Cartesia's tool timeout is 20 s).
8. **Question vs reasoning mismatch** (user report, not reproduced exactly). → the model must name the
   `awaiting_customer` work item its `nextQuestion` advances (`nextQuestionFor`); a question with no such
   item is rejected and the rule question is used.
9. **Open model-judgment issue (not fixed):** with a failed CRS identity check (Victor P12, Harold P14,
   Kayla P13) the model still proposes *approve*. AUTO-1 blocks payment and a person must confirm, but a
   prompt rule ("a failed identity check means verify the claimant first, never approve") is suggested.
10. **Live CRS fact:** P16 (Samuel) identity check returns `message_2401 IDENTITY VERIFIED - STEP-UP
    AUTHENTICATION RECOMMENDED (FRAUD ALERT ON FILE)`, which fails `identity_check_clear`.
11. Two smaller ones: the model sometimes omits `doneTitle` or sends `rulesConsulted` as bare strings
    (now defaulted / normalized instead of rejecting the whole assessment); a statement timeout left it
    uninterpreted forever (now retried once on a transient error).

## 2. Features and where they live

### Persona suite (data)
- `lib/fixtures/demoPersonas.ts`: 17 personas (`group: "core" | "suite"`), each with purchases (+ optional
  `deposits`, `alsoDisputedKeys`), a `customer` answer sheet (`opening`, `initiation`, `credentials`,
  `codePurpose`, `paymentPurpose`, `conflict`, `whichPayment`, `facts`) and `expected`
  (`route`, `failingChecks`, optional `match: "none"`, `reasonableDecisions`, `reviewFocus`).
  Also `seedDifferences()` (account vs seed).
- `lib/fixtures/crsPersonas.ts`: P02–P20 identity and Fraud Finder bodies added verbatim from
  `@crscreditapi/crs-calhacks-mcp-server@1.1.2` `dist/test-data/personas.json` (no credit/criminal products).
- Seeding: `scripts/seed-personas.ts` now posts deposits too. Then set `NESSIE_PERSONA_ACCOUNTS`
  (persona id → account id JSON) in the Convex env. The review deployment's mapping was seeded 2026-10-24.

The 13 suite scenarios: daniel (repeat merchant / cancelled subscription), jasmine (family access),
tomas (refund already received), lauren (late report, 75 days), nicole (over $100), elena (card testing,
three payments), terrence (changed story / non-delivery), dolores (tech-support remote-access scam),
harold (deceased indicator), priya (ambiguous match, then auto-approve), ricky (medium Fraud Finder 52),
marcus (phished OTP), kayla (synthetic identity + "approve it now" instruction in the statement).

### Dynamic customers
- `lib/fixtures/customerSim.ts`: `answerRuleQuestion()` (deterministic answer for every rule question kind;
  null = sheet can't answer), `customerSheet()` (the "if asked … say …" list, shown on `/call`),
  `customerBrief()` (everything the persona knows, for the simulator).
- `lib/providers/customerSimulator.ts`: Bitdeer plays the persona and answers the assistant's latest
  message only from the brief. Test aid only.
- `tests/personas.test.ts`: opens with the persona's opening, then answers whatever the rules ask next
  (each question at most twice), and fails if the sheet can't answer. `SHOW_TRANSCRIPTS=1` prints them.

### Live runner and page
- `convex/suite.ts`: `start({personaIds})` queues runs 12 s apart; `runOne` creates the persona case
  (`createPersonaCase` in `convex/personas.ts`), waits for persona setup, opens a text chat and loops
  customer ↔ assistant through `sendChatMessage` (exported from `convex/chat.ts`), at most 8 replies;
  `results` returns persona + latest run + observation + verdict. `questionKind` labels who asked
  (model / rules: kind / reviewer / wrap-up / closing). Table `suiteRuns` in the schema.
- `lib/review/suite.ts`: `suiteVerdict()`: pass = matched record + route + every expected failing check
  failed; extra failing checks are notes; unreadable statements or an already-reimbursed account make a
  run "incomplete"; the model's proposal is advisory (`modelReasonable`).
- UI: `components/review/ClaimSuite.tsx`, `app/review/suite/page.tsx`, nav link in
  `components/review/WorkstationBar.tsx`, styles under "Claim suite" in `app/review/review.css`.
  "Play it yourself" links to `/call?persona=<id>&channel=text` (`app/call/page.tsx` reads both params;
  its presenter notes render the answer sheet).

### Reset
- `convex/admin.ts` `resetAll` (internal): deletes up to 400 rows per table per call; returns `done`.
  `RESET_TABLES` must cover every table except `providerAuth` (test enforces it); add new tables there.
- `scripts/reset-convex.ts` (`npm run reset:convex -- --confirm [--keep-nessie]`): loops `resetAll`, then
  deletes this app's SIMULATED payouts (`isAppPayout` in `lib/domain/fraudSignals.ts`) from every persona
  account and the demo account (Nessie `DELETE /deposits/{id}`, verified; balance unaffected), and checks
  each persona account against its seed. Retries Nessie network blips. User-approved as the project's only
  Nessie delete; the app itself never deletes.

### Policy and reasoning changes (backend, UI-independent)
- `lib/domain/autoApproval.ts` v `2026-10-24.3`: `not_already_reimbursed` via `priorReimbursementSignal`
  (`lib/domain/fraudSignals.ts`). `convex/model.ts` `reimbursementsElsewhere()` uses the new
  `reimbursementDecisions.by_txn` index. `convex/proposals.ts` `resolve` refuses a second approval.
- `lib/providers/reasoning.ts`: `reasoningEffort` config + `reasoningEffortFromEnv`; extraction prompt
  (shared access, approximate amounts); case prompt (`nextQuestionFor`).
- `lib/domain/caseDecision.ts`: `nextQuestionFor` + validation; `lib/review/caseStatus.ts` exposes the
  work item's title; `components/review/CaseDecision.tsx` shows it.
- `lib/domain/investigation.ts`: lenient `rulesConsulted` and work-item defaults.
- `lib/providers/errors.ts` `isTransient`; `convex/reasoning.ts` retries once.
- `convex/intakeTurn.ts`: `takeTurn(ctx, result, channel)` with text-chat budgets.
- `lib/domain/interpret.ts`: scripted patterns for shared access, "I ordered it", remote-access scams.
- `lib/domain/answers.ts`, `lib/domain/workflow.ts`, `lib/domain/facts.ts`: the two question bugs above.

## 3. Porting checklist

1. Backend first (low conflict): policy guard, reasoning effort, answers/workflow/facts fixes, `nextQuestionFor`,
   text-chat budgets, lenient parsing, retry. Run `npm run verify`.
2. Data and tests: personas, CRS bodies, `customerSim.ts`, `tests/personas.test.ts`, `tests/suite.test.ts`.
3. Runner and reset: `convex/suite.ts`, `convex/admin.ts` (+ `suiteRuns` table, `by_txn` index),
   `scripts/reset-convex.ts`, `package.json` script.
4. UI last, re-done in the new frontend's style: the suite table (persona, expected, result, model proposal,
   verdict, actions; expandable review focus + transcript with "via" labels), "Play it yourself", the
   `/call` presenter answer sheet, and the "for the work item …" note by the model's question.
5. Env on the target deployment: `REASONING_EFFORT=low`, `NESSIE_PERSONA_ACCOUNTS` (17 ids), Bitdeer vars.
6. `npm run reset:convex -- --confirm`, then Run all on the suite page. Last result: 17/17 as expected.
