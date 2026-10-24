# UX remodel: first-pass audit and second-pass plan

_Written 2026-10-24 on branch `foundation` (`c0e064a` plus this pass's uncommitted changes). This is the
handoff for the frontend remodel. Pass 1 (this document) inspected, chose the stack and prepared the
foundation. Pass 2 does the remodel. Nothing here changes product policy: AUTO-1, the approve-only rule,
the evidence conventions and the model/code division of responsibility in `CLAUDE.md` all stand._

Product frame for the remodel: the reasoning model (Bitdeer) interprets statements, compares evidence, plans
the investigation and proposes a disposition; deterministic code validates, computes amounts, records diffs
and decides who may act; a person authorizes, overrides, escalates or returns. **A proposed outcome is never
an authorized one.** The UI must be results-first with evidence-linked explanations one step away, and must
never show raw model reasoning.

---

## 1. Skills loaded, and capabilities not available

Loaded from the skill catalog (real names):

| Skill | Used for |
|---|---|
| `run` | Launching the app and driving it as a user would (dev server plus a Playwright script in Chrome) |
| `artifact-design` | Frontend design fundamentals applied to the audit: typography pairing, token-based theming for light and dark, layout and spacing rules, copy, avoiding generic "AI" looks |
| `dataviz` | Dashboard information design: stat tiles vs charts, reserved status colours with icon plus label, "summary before detail" |

Not available in this session's catalog, so nothing was loaded for them: a Next.js or React skill (the bundled
docs in `node_modules/next/dist/docs/` were used instead, as `CLAUDE.md` requires), state management,
interaction design and motion, accessibility, and Playwright or browser automation. The catalog lists built-in
browser and Chrome-extension skills, but their tools are not connected here; the app was driven with Playwright
from a scratchpad script using the installed Chrome (`channel: "chrome"`), and that approach is now part of the
repo (`playwright.config.ts`, `tests/e2e/`). No shadcn, Tailwind or component-library skill exists.

## 2. Existing stack and reusable assets

**Stack (unchanged).** Next.js 16.4.3 (App Router, Turbopack) · React 19.3.1 · TypeScript 5.9 strict
(`noUncheckedIndexedAccess`) · Convex 1.48 cloud dev deployment as the single source of truth · zod 4 · npm with
exact version pins · Node 24 (`.nvmrc`) · ESLint 9 with `eslint-config-next` · Vitest 5 (199 tests, pure domain
code and `convex-test`; the environment is `node`, so no component renders in tests). Before this pass there
were no browser tests.

**Routes and their styling.**

| Route | File | Audience | Styling |
|---|---|---|---|
| `/` | `app/page.tsx` | developer | `app/globals.css` (48 lines, `system-ui`, hard-coded hex, default form controls) |
| `/cases/[caseId]` | `components/CaseDashboard.tsx` (409 lines) | developer | same, plus inline styles |
| `/call` | `app/call/page.tsx` + `components/VoiceCall.tsx` | customer and presenter | same, plus `.cc-*` and `.persona-*` rules |
| `/review` | `components/review/ClaimsQueue.tsx` | bank reviewer | `app/review/review.css` (783 lines) |
| `/review/[caseId]` | `components/review/CaseReview.tsx` and siblings | bank reviewer | same |
| `/review/demo` | `components/review/PitchDemo.tsx` | audience | same (`.pd-*`) |

**Design tokens.** `app/review/review.css` already defines a token system scoped to `.ws`: `--ws-bg / surface /
sunken`, `--ws-ink`, `--ws-ink-2`, `--ws-ink-3`, `--ws-line`, `--ws-line-2`, `--ws-accent`, `--ws-accent-weak`,
`--ws-ok / warn / crit`, `--ws-font`, `--ws-mono`, with a full dark palette under `prefers-color-scheme: dark`,
`:focus-visible` outlines, and `prefers-reduced-motion` guards. The other three routes do not use it.

**Libraries.** No component library, no Tailwind, no icon set (status marks are unicode: ✓ ✕ ■ ○ ▸ ≈ ≠ ⚠ →), no
animation library (CSS transitions and one `ws-pulse` keyframe). State: Convex `useQuery` subscriptions
(reactive, live), `useMutation` / `useAction`, URL state for queue selection (`?case=`), two React contexts
(`HighlightProvider` for evidence highlighting, `WorkspaceMode` for live vs demo). No client state library is
needed.

**Assets to reuse rather than rebuild.**

- `lib/review/caseStatus.ts`: the investigation-first view model (who acts, headline, proposed disposition,
  authorized outcome, blockers). Shared by the queue query (`convex/review.ts`) and the workspace. Tested in
  `tests/caseStatus.test.ts`.
- `lib/review/workspace.ts`, `timeline.ts`, `intake.ts`: pure view models (reconciliation, findings groups,
  decision trace, prepared outputs, timeline, intake turns). Tested in `tests/review-views.test.ts`.
- `components/review/EvidenceRef.tsx`: ref chips with linked highlighting and `goToRef()` (opens collapsed
  sections, scrolls, focuses). This is the core of "evidence-linked explanations" and works well live.
- `components/review/Tags.tsx`: provenance and audience markers that use shape plus label, never colour alone
  (reported ○, observed ■, inferred ◇, recommended ▶; customer ○, bank ■). A product-specific visual language
  worth keeping, redrawn as SVG.
- `components/review/EvidenceTrail.tsx`: the reported-vs-observed reconciliation table.
- `components/review/ClaimsQueue.tsx`: grouping by who acts, search, filter, keyboard listbox, URL deep links.
- `components/review/format.ts`: `caseRef`, `usd`, `exactTime`, `relativeTime`, label maps.
- `components/VoiceCall.tsx` with `CallDisplayBoundary` (a display error cannot end a call).
- `tests/helpers/demoCase.ts`: builds a complete `CaseView` from the scripted scenario with the real pure code.
  Reusable for component tests and for rendering the real workspace in demo mode.
- `lib/fixtures/demoPersonas.ts`: the four demo personas with ledgers, expected outcomes and scripts.

## 3. Implementation-status map

Observed on the dev deployment (`dynamic-chihuahua-120`, 11 cases) through the browser, read-only.

**Working end to end**

- Persona cases set themselves up: Nessie retrieval, payment-origin records, CRS identity check and Fraud
  Finder (activity log of FC-8GW49W shows all four within 3 s of creation).
- Bitdeer statement extraction (`Read by model · bitdeer:zai-org/GLM-5.3-Flash` on every statement card).
- Rule analysis and matching; AUTO-1 automatic approval with a SIMULATED Nessie deposit (two decided Margaret
  cases, `deposited`).
- Whole-case model assessments on newer cases (FC-8GW9M3 shows a model summary and a proposed approval).
- Queue: groups, counts, search, filter, keyboard (↑/↓/Enter), sticky preview, `?case=` deep link.
- Workspace: overview, investigation, findings, collapsible decision record with six parts; chip hover
  highlights every element carrying the ref (30 elements highlighted in the probe); dark mode; no horizontal
  overflow at 400 px.
- `proposals.resolve` (approve with SIMULATED payout, confirm denial, reject proposal) is wired in
  `components/review/CaseDecision.tsx` `ResolveControls`. Not exercised in this pass: no dev case is currently
  awaiting a person.
- Customer line: persona picker, "new report" vs "existing case", presenter notes, call client (live calls
  were verified by the user earlier today; not started in this pass).

**Mocked or fixture-driven**

- `/review/demo`: the customer's lines and every model output are prewritten (`lib/fixtures/pitchDemo.ts`); the
  matcher, validator, execution plan and AUTO-1 run for real on them (`lib/review/pitchDemo.ts`). Act 5's
  Authorize / Override / Return buttons change browser state only.
- Payment-origin records are SYNTHETIC presets (`lib/fixtures/paymentOrigins.ts`); CRS subjects are published
  test personas; demo personas are seeded Nessie accounts. All labelled as such in the UI.

**Incomplete or disconnected**

- A flagged automatic approval (`reimbursementDecisions.needsReview`) has no action to resolve it. The top item
  in today's queue (FC-8GW9M3, "Review the approval: … now failing: all_statements_interpreted") is a dead end.
- Override, return-to-agent, reviewer notes and a banker-written question for the call-back are not persisted
  anywhere (demo only). `CONTEXT.md` item 4.
- The workstation lacks controls that only the developer case page has: submit a text statement
  (`cases.submitStatement`), attach a payment-origin preset (`paymentOrigins.setSynthetic`), link a CRS persona
  and run the checks (`crsData.linkPersona`, `crs.retrieveIdentityEvidence`, `crs.retrieveFraudRisk`), retry a
  payout (`payoutData.retryPayout`), retry or script an interpretation (`statements.retryLive`,
  `statements.interpretScriptedExplicitly`). The statement card in the workspace literally says "retry from the
  developer console".
- **Crash (fixed in this pass):** opening FC-8GW9M3 in the workspace threw `Cannot read properties of undefined
  (reading 'changes')`. Proposals stored before the investigation restructure have no `investigation` field;
  `CaseReview.tsx` and `CaseInvestigation.tsx` read it unguarded. Two optional-chaining guards fix the crash; a
  proper `readStoredProposal()` normaliser is listed under gaps.
- `caseStatus()` labels the investigation "Reasoning model" whenever an accepted proposal exists, even when it
  had to fall back to the rule-based work items because that proposal has no `investigation`
  (`lib/review/caseStatus.ts` lines 104–111). The queue preview for FC-8GW9M3 shows rule items under a
  "model" tag.
- The model's `summary` is cut at 600 characters with no ellipsis (`text(600)` in `lib/domain/caseDecision.ts`);
  the queue preview shows "…eligible under small-claim policy AUTO-1@".
- "Investigating" is empty almost always (it only holds cases while a reassessment is pending).
- `components/IntegrationStatus.tsx` hard-codes "Simulated reimbursement: not implemented" although the
  payout exists and `system.integrationStatus` reports it.
- `cases.view` returns the whole case document to the browser, including `nessieAccountId` and the stored
  analysis; the UI never needs the account ID.
- No sign-in or access control (known; `CONTEXT.md` item 5).

**Dynamic or fixed script?** Genuinely dynamic. Every evidence change recomputes the analysis and, with live
reasoning on, asks the model to reassess the whole case (`convex/model.ts` `recomputeAnalysis` →
`convex/proposals.ts` `maybeRequestProposal`), at most once per case state. Work items, uncertainties and the
next customer question come from the model's validated output; the fixed rules are the labelled fallback.
Every assessment is kept with a code-computed diff. The pitch demo is a fixed script by design and says so.

**Shared state or inconsistent data?** All live panels read the same three subscriptions (`cases.view`,
`proposals.latest`, `review.queue`) and the same `caseStatus()`; nothing is hard-coded. One inconsistency: the
queue sorts rows by `triage.attention` (the rule-based triage) but groups them by `status.attention` (the
model-first status), `components/review/ClaimsQueue.tsx` line 80, so order within a group can be surprising.

**Screens that repeat the same information**

- Findings appear in three places on one case page: "Established and open" (the investigation), "Decision
  trace → Facts used", and "Findings and open questions" (the rule-based panel), and the reported facts appear
  again in the evidence trail table and in each statement card's extraction.
- The case status appears four times: header pill, "Status" key fact, the Outcome box, and the "Next" headline
  (which on a decided case is the outcome label again).
- The queue summary sentence repeats the counts shown on the filter buttons.
- Fully expanded, the decision record makes the case page 7,952 px tall at 1440 px wide (12,479 px at 400 px).

**Dead or misleading controls**

- "Review the approval" (queue headline and Next step) with no control that reviews it.
- "Details" in the Outcome panel (`CaseDecision.tsx`, `<a href="#rec-rules">`) scrolls to a collapsed
  `<details>` without opening it.
- "Reassess now" is the only button on the Outcome panel of a decided case; it is a paid live call.
- "Retrieve bank records again" is offered on decided cases; it re-runs the analysis (safe, idempotent, but
  pointless there).
- `/`: "Simulated reimbursement: not implemented" and "Factory Droid" rows in the integration table.
- `/call`: the presenter notes, ledger and suggested lines sit inside the customer-facing page.

**Uncustomised default look.** `/`, `/cases/[caseId]` and `/call` are browser-default controls and tables with
`system-ui`. The workstation is designed, but its warm cream palette and sans-serif reads as a generic
template rather than a bank operations console.

## 4. The most important UX and functional problems (ranked)

1. **The reviewer's job has no controls where the reviewer works.** Flagged approvals cannot be resolved;
   overrides and returns are not saved; evidence actions live only in the developer console.
2. **Internal identifiers leak into reviewer language.** `all_statements_interpreted`,
   `AUTO-1@2026-10-24.2`, `payment_origin_supports_claim`, `T:af01…0268`, and the customer shown as
   "Margaret Okafor (SYNTHETIC demo persona; CRS test identity P01)".
3. **Redundancy and length.** The same facts in three to five places; an 8,000 px decision record; ref chips
   scroll the reader away from the conclusion instead of showing the source beside it.
4. **Proposed vs authorized is textual, not visual.** The decision band (proposal, plan, who must act,
   authorized outcome, payout state) is split across the Outcome box, the "Next" text and the header pill.
5. **Queue rows carry whole question sentences as headlines**, no customer name, no visual state encoding,
   counts in prose, and "No report yet" cases from abandoned calls clutter the list.
6. **Three visual systems** (workstation tokens, globals.css defaults, inline styles) and unicode glyph icons.
7. **The customer line mixes audiences** (presenter notes on the customer page) and the live call has no
   visual presence beyond a sentence (no listening/speaking indicator).
8. **The product's key moment is invisible.** When the model reassesses, rows move between groups and work
   items change status with no transition, so "the investigation adapts as information arrives" cannot be seen.
9. **Accessibility baseline is decent** (roles, shape-plus-label markers, focus rings, reduced motion, ≥ 4.5:1
   on the muted ink) but: `title`-only tooltips on chips, the anchor into a collapsed section, widespread 11–12.5 px
   text, and queue rows are clickable `div`s (keyboard works through the list's own handler).

## 5. Dependencies: added and recommended

Added in this pass (exact pins, `package-lock.json` updated by npm, no other upgrades):

| Package | Version | Why |
|---|---|---|
| `lucide-react` | 1.59.0 | One icon set to replace the unicode status glyphs, which render differently per platform and carry meaning (✓ ✕ ■ ○). Tree-shakable SVG, React 19 peer. Always paired with a text label. |
| `motion` | 14.3.1 | Purposeful motion only where it carries information: queue rows moving between "who acts" groups when the model reassesses (`layout` + `AnimatePresence`), work-item status changes, the evidence inspector sliding in. Hover and focus stay in CSS. `useReducedMotion()` honoured. |
| `@playwright/test` (dev) | 1.64.1 | No browser tests existed. The smoke suite in `tests/e2e/` drives the installed Chrome (`channel: "chrome"`, no browser download) and is how the remodel gets screenshot review and regression checks. |

Not added, with the reason:

- **Tailwind:** 783 lines of working, scoped tokens already exist; Tailwind would be a second styling system or a
  rewrite with no usability gain. Keep plain CSS and promote the tokens to the whole app.
- **shadcn / Radix:** the needs are collapsible sections (`<details>`), a confirmation dialog (`<dialog>` with
  `showModal()` gives focus trap, Escape and inert background), tabs (small roving-tabindex component) and
  tooltips (visible labels plus `title`). Add `@radix-ui/react-dropdown-menu` only if the design settles on a
  "more actions" menu.
- **React Flow:** the investigation is an ordered list of work items with status, not a graph. A node map
  would suggest "AI" without solving a usability problem.
- **Charts:** there is no numeric series to plot. Counts become stat tiles.
- **State library:** Convex subscriptions, URL state and two contexts are sufficient.

Recommended, no install needed: `next/font/google` for the typefaces (self-hosted at build time; see
`node_modules/next/dist/docs/01-app/01-getting-started/13-fonts.md`; non-variable Google families need an explicit
`weight` array).

## 6. Proposed visual direction

The user's references (`visualReferences/`: Modern Treasury, Stripe payment detail, Adyen issuing disputes,
Unit21 alerts, Ramp reporting, a Stripe disputes app) share one register: an **operations console**. White
surfaces on a cool light-grey canvas, hairline rules, dense tabular 13–14 px UI type, a single deep blue for
selection and the primary action, semantic status (good / warning / critical) always carried by an icon or a
word as well as colour, a left navigation rail, stat tiles above a table, and a timeline on the detail page.

Direction for pass 2:

- **Palette:** cool neutrals replace the warm cream. Keep `--ws-accent` (#1f4a7a) as the single accent. Status
  colours stay reserved for state (never series or decoration). Dark theme kept through the same tokens.
- **Type:** IBM Plex Sans for UI, IBM Plex Mono for refs, amounts and timestamps (`font-variant-numeric:
  tabular-nums` everywhere digits align), via `next/font/google`. Minimum body size 13 px; 12 px only for
  captions.
- **Marks:** keep the provenance and audience shapes (reported ○, observed ■, inferred ◇, recommended ▶;
  customer ○, bank ■) as the product's own visual language, redrawn as SVG components.
- **Chrome:** a collapsible left rail (Queue, Demo, Customer line, Developer) replaces the four-link top bar; a
  sticky case header carries the case identity and the primary action. The "Prototype · synthetic data"
  notice becomes a compact badge in the rail footer.
- **Nothing decorative:** no gradients, no rotated cards (act 1 of the demo), no numbered markers unless the
  content is a sequence (the demo acts are).

Token sketch to start from (light values, dark values redefined under the same names):

```css
:root {
  --bg: #f6f7f9;  --surface: #ffffff;  --sunken: #eef0f3;
  --ink: #16181d;  --ink-2: #454a54;  --ink-3: #6b717c;
  --line: #e3e6eb;  --line-2: #c9ced6;
  --accent: #1f4a7a;  --accent-weak: #e6eef7;  --on-accent: #ffffff;
  --ok: #1e6b3a;  --warn: #8a5300;  --crit: #a3262c;
  --font-ui: var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, Menlo, Consolas, monospace;
}
```

## 7. Proposed case-workspace structure

One exceptional case page, results first, evidence one step away. Everything below exists as data today; the
work is arrangement, labels and the missing actions.

```
┌ Case header (sticky) ──────────────────────────────────────────────────────────────┐
│ FC-8GW9M3 · Margaret Okafor [demo] · $58.00 PixelPlay Games · Oct 23 · T:af01…   │
│ [status pill, once]  who acts  reported 11:16 PDT                 [Primary action] │
├ Decision band ───────────────────────────────────────────────────────────────────┤
│ PROPOSED (model)  Approve reimbursement · $58.00 (computed from T:af01…)           │
│ plan: needs a person → [Approve · SIMULATED payout] [Reject with reason]           │
│ AUTHORIZED (policy AUTO-1) Approved automatically · payout deposited               │
│ ⚠ Flagged: facts changed after approval → [Affirm approval] [Keep flagged + note]  │
│ Why (3–5 cited points with chips) · Guardrail: rules say "reimbursement review"    │
├ Narrative column ──────────────────────────────┬ Decision rail (sticky) ──────────┤
│ What happened: customer's words + key facts    │ Next step and who does it         │
│ Investigation: work items, live "reassessing"  │ Override ▸ / Return to agent ▸    │
│ Established · Open · Hypotheses (one view)     │ Reassess (secondary, cost shown)  │
├ Record tabs ────────────────────────────────────┴──────────────────────────────────┤
│ Evidence │ Rules & checks │ History │ Conversation │ Documents │ Activity          │
└────────────────────────────────────────────────────────────────────────────────────┘
          Evidence inspector: a right-side panel opened by any ref chip, showing the
          source in context (statement + how it was read; record row + reconciliation;
          provider fact), with "go to section". Non-modal, Escape closes.
```

- **Header:** case ref, customer name (demo-ness as a separate small badge, not in the name), payment line,
  the status pill (the only place status is written), who acts, report time, overflow menu.
- **Decision band:** the result. Proposed disposition with computed amount and execution plan, the controls a
  person may use for it, the authorized outcome with payout state, and the flagged-approval resolution. "Why"
  as the model's cited rationale points, chips open the inspector. The rule-based route is one secondary line.
- **Narrative column:** the three existing sections, tightened: one findings view (drop the rule-based
  "Findings and open questions" and "Facts used" duplicates into the Rules tab as a collapsed guardrail view).
- **Decision rail:** next step, override and return controls (persisted), reassess demoted and labelled with
  its cost.
- **Record tabs** replace six stacked `<details>`: Evidence (reconciliation table, statements, bank records with
  the payment-origin attach action, identity with the CRS run action), Rules & checks (AUTO-1 checklist with
  human titles, the model's legal readings, rule-based trace collapsed), History (assessment diffs), Conversation,
  Documents, Activity.
- **Inspector** replaces scroll-to-source as the default chip action (keep "go to section" inside it).

Queue structure: stat tiles for the four "who acts" counts (filters), rows with customer name, payment,
one-line next step (not the whole question), status chip, blockers as an icon with a count, relative time;
"No report yet" hidden behind a toggle; rows animate between groups on live updates.

## 8. Data-model and API gaps that block a functional redesign

Backend changes are small and additive; none touch `autoApproval.ts` or `regulatory.ts`.

1. **Resolve a flagged approval.** New mutation, e.g. `payoutData.reviewFlaggedApproval({ decisionId, affirm,
   note })`, that records who looked (`needsReview.reviewedAt`, `note`, `affirmed`) and logs activity. Money is
   never reversed automatically; "keep flagged" stays a reviewer note. `caseStatus()` then stops treating an
   affirmed flag as "needs a reviewer".
2. **Persist override and return-to-agent.** Either extend `caseProposals.resolution` with `kind:
   "override" | "returned"`, `decision`, `note`, or add a `reviewActions` table (`caseId`, `proposalId?`, `kind`,
   `decision?`, `note`, `at`). `caseStatus()` needs the branches; a banker's note should become the next
   call-back question ahead of the model's (`convex/proposals.ts` `modelQuestionFor` precedence, used by
   `convex/voice.ts`).
3. **Human labels for machine ids.** AUTO-1 checks only carry `id` and `detail`; `needsReview.reason` is built
   from ids in `convex/model.ts` `applyAutoApproval`. Add `needsReview.failedChecks: string[]` (optional field)
   and a label map in `lib/review/labels.ts` (check id → title, policy id → "small-claim policy", plan kinds,
   decisions). `lib/domain/autoApproval.ts` stays untouched.
4. **`readStoredProposal()`** in `lib/domain/caseDecision.ts`, mirroring `readStoredAnalysis()`: fills
   `investigation` (`EMPTY_INVESTIGATION`), `documents`, `legalBasis` for proposals stored before 2026-10-24's
   restructure. Use it in `caseStatus`, `CaseReview`, `review.queue`, `proposals.latest` and `currentInput`.
   Make `caseStatus.source` say "rules" when the investigation came from the fallback.
5. **Queue projection.** `convex/review.ts` `queue` should return `customerLabel`, `demoPersonaId`, the
   proposal's `plan.kind`, and `needsReview` as structured data; sort and group on the same attention value.
6. **Summary truncation.** Either raise `summary` to 1,000 characters or make `text()` append "…" when it cuts,
   and ask for a two-sentence summary in the prompt.
7. **`cases.view` projection.** Return a view model without `nessieAccountId` (keep `nessieAccountBound`).
8. **Assessment history** (`proposals.latest.history`) only includes accepted rows; include failed and
   rejected rows with their reason so the History tab can show them.
9. **Customer identity in the data.** `customerLabel` holds a presentation string; a structured
   `{ name, demoPersonaId, crsPersonaId }` lets the UI show the name and badge the demo-ness separately.
10. Out of scope for the hackathon but noted from `docs/claim-intake-design.md`: per-payment fact model, case
    close action, assignment, deadline estimates, documents.

## 9. Prioritised second-pass plan

Favour one exceptional case page and demo journey over restyling every screen. Each phase ends with
`npm run verify` and `npm run test:e2e`, and a `CONTEXT.md` entry.

**Phase 0 · Foundation (half a day).** `app/tokens.css` with the console palette (light and dark) and
`next/font` Plex faces, applied to every route; icon components (`components/ui/Icon.tsx` wrapping Lucide with
required labels; SVG provenance marks replacing the CSS shapes in `Tags.tsx`); app shell with the left rail and
case header; `lib/review/labels.ts`; retire `globals.css` defaults. Dark theme checked.

**Phase 1 · Case workspace (one day).** Items 1–4 and 7 of section 8 in Convex and `lib/review`; the decision
band with resolve, flag-review, override and return controls; evidence inspector; record tabs; one findings
view; human labels everywhere; payment-origin attach and CRS run moved into the Evidence tab (so the developer
case page is no longer needed in the demo). Component tests with `tests/helpers/demoCase.ts`; e2e: open the
flagged case, open the inspector from a chip, resolve a proposal on a seeded case.

**Phase 2 · Queue (half a day).** Stat tiles, redesigned rows, customer names, hide "No report yet" by default,
`motion` layout animation on group changes, consistent sort/group, empty and loading states.

**Phase 3 · Customer line and demo (half a day).** Split the presenter notes into a collapsible presenter
drawer; customer-grade call screen with a visible listening/speaking state and the transcript; demo acts 4 and
5 render the real decision band and record components in demo mode (`WorkspaceMode`), so the pitch and the
product look identical.

**Phase 4 · Hardening (half a day).** Expand `tests/e2e/` (screenshot walk of every route for review, keyboard
paths, dark mode), an accessibility pass (focus order, names on icon buttons, 13 px minimum), favicon,
`IntegrationStatus` accuracy, fold the developer console into the shell as a "Developer" page.

## 10. Commands run in this pass and their results

| Command | Result |
|---|---|
| `npm run verify` (baseline, before any change) | typecheck, lint, 199 tests, build: all pass |
| Playwright inspection script (scratchpad; read-only walk of `/review`, a case, the record expanded, dark mode, 400 px, `/review/demo` acts 1–5, `/call`, `/`, `/cases/[id]`, `/review` at 900 px) | Rendered; console showed only a favicon 404 and the Next 16 `scroll-behavior` warning; no horizontal overflow at any width; chip hover highlighted 30 elements |
| Probe: open FC-8GW9M3 (`/review/jx73ejhb…`) | **Crash:** `Cannot read properties of undefined (reading 'changes')` (error boundary shown). Fixed with two guards; re-probed: renders |
| `npm i -E lucide-react@1.59.0 motion@14.3.1`, `npm i -D -E @playwright/test@1.64.1` | Installed; `package.json` pins exact versions; lockfile updated by npm |
| `npm run verify` (after installs, config, html attribute) | all pass (199 tests) |
| `npm run test:e2e` (first run) | 3 passed, 1 skipped (test waited on the skeleton rows); fixed the wait |
| `npm run test:e2e` (second run) | 3 passed, 1 failed: the keyboard-open test hit the FC-8GW9M3 crash above |
| `npm run test:e2e` (after the guard) | 4 passed |
| `npm run verify` (final, after the guard) | all pass: typecheck, lint, 199 tests, build |
| Probe of FC-8GW9M3 after the guard | Renders: model summary, stale proposal, flagged outcome with no resolving control; the "Details" anchor leaves `#rec-rules` closed (`open` false before and after); 16 of 57 leaf text elements on the page are under 12 px |

Not run: anything that creates, deletes, retrieves, pays, reassesses or places a call. The Convex watchers
were not running during this pass (only the Codex runtime node process was alive), so nothing was pushed to
dev; the component guard is in the working copy only.

## Appendix: files changed in this pass

- `package.json`, `package-lock.json`: three dependencies, `test:e2e` script.
- `playwright.config.ts`, `tests/e2e/smoke.spec.ts`: smoke suite (read-only).
- `app/layout.tsx`: `data-scroll-behavior="smooth"` on `<html>` (Next 16 upgrade note; removes the console warning).
- `components/review/CaseReview.tsx`, `components/review/CaseInvestigation.tsx`: guards for proposals without
  `investigation`.
- `.gitignore`: `test-results/`, `playwright-report/`.
- `docs/ux-remodel-plan.md` (this file), `CONTEXT.md`.

---

# Pass 2: what was delivered (2026-10-24)

The remodel is implemented on `foundation` (uncommitted at the time of writing). Everything below was run in
the browser against the dev deployment with the installed Chrome, read-only except for one deliberate write
(a reviewer note on the flagged approval FC-8GW9M3), which persisted and shows in the flag box, the decision
record and the timeline.

## Decisions, the reviewer problem each solves, and the reference behind it

| Decision | Reviewer problem | Reference (from `visualReferences/`) | How it fits our data |
|---|---|---|---|
| Decision band first: three blocks, Proposed / Authorized / Executed | "What is proposed, what is authorized, what has happened" were four scattered strings | Stripe payment detail: amount and state at the top, timeline beside | `caseStatus.disposition`, `caseStatus.outcome` and `decisions[].payout` map one to one onto the three blocks |
| Persistent inspector beside the main column, tabs Record / Timeline / Evidence / Conversation, detail on selection | Chips used to scroll the reviewer away from the conclusion | Stripe's details column; Modern Treasury's activity feed beside the table | Every selection resolves through `lib/review/inspector.ts` from stored data; a ref the case lacks is shown as missing |
| Left rail with four destinations, prototype notice in its footer | Four audiences shared one top bar | Modern Treasury, Unit21 and Ramp all use a quiet left rail | Only four routes exist, so the rail stays short; the customer line gets a separate frame |
| Queue counts as stat tiles that filter; rows with customer, payment, status pill, one-line next step | Whole questions as headlines, no customer name, counts in prose | Unit21 "My Open Alerts" tiles; Adyen's filter chips and tabular rows | `review.queue` now projects `customerLabel`, `planKind`, `flag`; empty "no report" cases are a toggle |
| Human labels for every machine id | Check ids and policy version strings in reviewer text | Every reference uses plain words for state | `lib/review/labels.ts`; `needsReview.failedChecks` stored structurally; legacy reasons parsed |
| Provenance marks kept (reported ○, observed ■, inferred ◇, model ▶, person) redrawn as SVG | Colour alone must never carry evidence status | None of the references do this; it is this product's own language | `components/review/ui.tsx` `Mark` |
| Cool neutrals, IBM Plex Sans and Mono, one blue accent, status colours reserved | Warm cream read as a template; unicode glyphs rendered unevenly | Common register of all six references | `app/globals.css` tokens, light and dark |
| Motion only where it carries information (queue rows moving between groups, drawer slide) | Reassessments changed the queue with no visible cause | None | `motion/react` layout animation, off under reduced motion |

## What changed

**Backend (additive, deployed to `dynamic-chihuahua-120` with `npx convex dev --once`):** `reviewActions` table
(overrides, returns, notes); `proposals.override`, `proposals.returnToAgent` (records the request and, with live
reasoning on, reassesses with it in the model input as `reviewerRequests`); `payoutData.reviewFlaggedApproval`
(affirm or keep flagged with a note; nothing reversed); `reimbursementDecisions.needsReview.failedChecks` and
`.review`; `review.queue` projection; `proposals.latest.history` includes failed and rejected rows; `cases.view`
no longer sends `nessieAccountId`; the reviewer's question outranks the model's on the call-back
(`modelQuestionFor`); summaries end with an ellipsis when cut; `readStoredProposal()` normalises proposals
stored before the investigation format (the crash from pass 1).

**Workspace (`components/review/`):** `CaseWorkspace` → `CaseHeader`, `DecisionBand` + `ReviewActions`
(dialogs on the native `<dialog>`), `FindingsPanel`, `FrameworkPanel`, `OutputsPanel`, `WorkPanel`, `Inspector`
+ `InspectorDetails`, `WorkspaceContext` (shared state and selection), `ui.tsx` (Mark, Pill, Tabs, Item,
ActionDialog). Removed: `CaseDecision`, `CaseInvestigation`, `Investigation`, `Tags`, `WorkspaceMode`,
`WorkstationBar`, `SiteBanner`. Evidence tab gained the actions that only the developer page had: retry an
interpretation, attach a payment-origin preset, run the CRS checks.

**Queue, demo, customer line, developer pages:** `ClaimsQueue` rewritten; `PitchDemo` act 4 renders the real
workspace components in demo mode (controls disabled and labelled, provider labelled "scripted-replay"), act 5
keeps a browser-only control moment labelled as not saved; `/call` keeps the customer view clean with the
presenter panel collapsed; `/` and `/cases/[id]` wear the shell and tokens.

## Live, mocked, incomplete

- **Live:** everything on `/review`: Convex subscriptions, Nessie, CRS, Bitdeer extraction and reassessment,
  AUTO-1 payouts (simulated money), the new reviewer actions.
- **Fixture:** `/review/demo` (scripted model outputs, real guardrails, real components). Payment-origin
  records and CRS subjects are synthetic everywhere, labelled.
- **Incomplete:** no sign-in; overrides to "approve" are deliberately impossible; a reversal of a flagged
  payout has no path (the flag review says so); the voice personas have not been rehearsed against the new
  reviewer question precedence; `CaseDashboard` is restyled, not redesigned.

## Checks

`npm run verify`: typecheck, lint, 213 tests, build all pass. `npm run test:e2e`: 4 Playwright smoke tests
pass (demo act 4 inspector, queue, keyboard open with inspector tabs, customer line). Browser walk: no console
errors except the deliberate bad-link probe (handled by the error boundary); no horizontal overflow at 1440,
1024 or 400 px; dark theme checked; dialogs trap focus and refuse empty required fields.

---

# Pass 3: repass and the scroll-driven demo (2026-10-24)

Pass 2 was rejected on taste: cool grey palette, uneven spacing, helper copy everywhere, a slide-style demo.
This pass restores the warm palette, removes nearly all explanatory copy, and replaces the demo with one
scroll-driven story that ends in the real workspace. Everything was checked in the browser (installed Chrome
through Playwright, read-only; the demo's reviewer actions live only in page state).

## Reference videos

The four recordings in `visualReferences/` (Cal Hacks 13.0, 826 National, Meet NYU, Stamps) were read as
frames (OpenCV in a scratchpad venv; no ffmpeg on this machine). What carried over:

- **One composition per viewport, pinned.** Cal Hacks pins a scene and lets scroll change what is on it; the
  demo uses one sticky 100 vh stage and a runway of eight beats (`components/demo/DemoStory.tsx`).
- **Objects persist and move.** Stamps and 826 keep the same hero objects while the layout re-flows around
  them; the call surface, the matched record, the sources and the model panel keep their identity across
  beats (`motion` layout ids) and only change place and size.
- **Breathing room and a quiet register.** NYU's single-column rhythm and wide gutters: the stage has one
  title, three columns at most, and the hint "Scroll" is the only chrome. No feature cards, metrics or
  diagrams.
- **Scene changes carry meaning.** Cal Hacks changes the ground colour between chapters; the stage turns
  dark for the model's scene and back to the page colour for the deterministic checks, so the viewer can
  tell the model's work from code's without a label.

## The demo (`/review/demo`)

| Beat | What is on the stage |
|---|---|
| 0 | The call surface, centred: S1 arrives. "Simulated voice" is the only label |
| 1 | The $49 GiftCard Hub record docks beside it, tagged "Matched · code" |
| 2 | The other three records fan out, dimmed; the curated sources stack on the right |
| 3 | Dark scene. The model panel ("Bitdeer · scripted replay"): "Possible unauthorized payment", two work items, its next question appears as an agent bubble |
| 4 | S2 arrives: "I did, yes. A man from the bank's fraud team called and told me to buy it" |
| 5 | The interpretation strikes through and becomes "Customer-sent payment, induced by a bank impersonator". The earlier assessment stays above it as "Previous assessment · kept"; the identify item does not move; changed items are tinted; 1005.2(m) reads "Likely doesn't apply", policy DP-1 "Likely applies"; the two drafts carry "Needs reassessment" |
| 6 | S3 arrives; "Card exposure checked" and "Handling route chosen" complete |
| 7 | Back to the page colour. The proposal "Escalate to a specialist" with three cited reasons; five guardrail checks tick; "7 of 14 checks pass · a person decides" |
| finale | "A person decides." The real `CaseWorkspace` in demo mode. The Record tab lists both assessments. "Decide differently" and "Return to investigator" open the real dialogs and update the band on page state; approve is not offered because the evidence does not support it |

Scroll is the only control. Space, ↓, → advance a beat; ↑, ← go back (a pending-target ref makes rapid presses
cumulative). A 2 px progress hairline is the only indicator. Reduced motion cuts between beats. Under 1000 px
the stage stacks to one column and scrolls inside itself; the finale uses the workspace's own drawer.

## The repass

- `app/globals.css`: warm tokens (light `#f5f3ee` / `#fffefb` / ink `#1b1a17`, accent `#1f4a7a`; dark
  `#141311` / `#1c1b18` / `#ece8e0`, accent `#93b6e4`), 14 px body, cards with a 1 px line and 10 px radius,
  spacing scale 4–32. Status colours only on marks, pills and left borders.
- `app/review/review.css` rewritten on the card treatment: queue tiles as pills, rows as inline flex with
  chips wrapping after the text, two-column panels with a vertical rule, the inspector on a sticky bar.
- Copy: helper paragraphs, hints, eyebrows and prototype notices removed across the shell, header, decision
  band, panels, inspector details, queue, call page and voice component. What remains: "Synthetic data ·
  simulated money" in the rail footer, "simulated" beside payout lines, "Simulated voice" and "Scripted
  replay · synthetic data" on the demo, and short empty states ("Nothing open.", "Not yet").
- Page titles no longer say "(prototype)".

## Checks

- `npm run typecheck`, `npx eslint .`, `npx vitest run` (213 tests), `npx next build`: pass.
- `npx playwright test` (4 tests, including the rewritten demo test: keys advance beats, the clarification
  changes the interpretation and flags the drafts, the finale takes a local "Ask the customer" decision): pass.
- Browser walk: demo at every beat at 1440 × 900 in light, dark and reduced motion, plus 400 px; the queue
  and FC-8GW9M3 at 1440 (light and dark), 1024 and 400 (drawer open). No page errors, no horizontal overflow.

## Palette brief (later the same day)

The user asked for a warm, neutral, productivity-first palette with a muted indigo accent and surfaces that
separate navigation, workspace and inspection without relying on borders.

- Tokens (`app/globals.css`): canvas `#f6f4ef`, cards `#fffdfa`, rail `--surface-nav #ebe7df`, inspector and
  queue preview `--surface-inspect #f2efe9`, charcoal ink `#26241f`, accent `#4a4f9c` (7:1 on white) with
  `--accent-weak #e7e8f4`. Dark mode mirrors it with a soft indigo `#a9ade6`.
- Functional colour: selected rows, the current nav item and the Proposed label are indigo; the Authorized
  label is green; "Case changed since" and the flag box are amber; blockers are red. Every status colour
  sits beside a label or mark.
- The demo's model scene moved from a dark ground to an indigo-tinted one; changed work items are tinted
  amber rather than indigo so they do not read as selected.
- Focus rings use the accent; document previews in the inspector sit on the card surface for contrast.

## Customer line (later the same day)

Reference: a Hume voice-chat screenshot the user supplied (open canvas, a centred figure in soft rings, one
state word, three round controls). Ours keeps the composition and none of the character, branding or
emotion badges.

- **Canvas.** `/call` is a full-height page on beige `#f3efe7` with a peach wash top-left and a sage wash
  top-right, a minimal header (brand left, "Fraud support assistant" centred, presenter popover right) and a
  fine centred rule. No panels, no borders.
- **Figure.** An original line drawing of a young deer (`components/call/AgentFigure.tsx`) on an ivory
  disc: charcoal strokes, peach cheeks, sage flecks, one indigo stroke.
- **Rings.** Three concentric rings scale with a `--lv` variable that the call writes from real audio: the
  microphone chunks' RMS while the customer speaks, the agent chunks' RMS at the moment they are heard.
  Sage tint while listening, indigo while the assistant speaks, ivory when idle. Reduced motion stops the
  animation frame and keeps the tints.
- **Label.** Ready / Connecting / Listening / Speaking / Call ended beneath the figure; the clock or a short
  note under it. No emotion badges: nothing in the system measures them.
- **Controls.** Mute (a real microphone-track toggle, disabled outside a call), start (indigo) or end (the
  only red on the page), transcript (opens a side panel on desktop, a bottom sheet on phones, with a count
  badge). The presenter's persona and call-back controls keep their class names and behaviour.
- **Labelling.** "Live voice assistant · synthetic account" in the footer; the presenter pill always says who
  the synthetic caller is.

## Light theme (later the same day)

The user supplied a white-dominant dashboard reference with purple and peach accents and an exact token
list. Applied globally through `app/globals.css`; no component changed except where a dark fill was
hard-coded.

| Token | Light | Dark |
|---|---|---|
| page `--bg` | `#EFEDF3` (spec `#F5F4F7`, darkened on request for contrast with the cards) | `#15141A` |
| surface `--surface` | `#FFFFFF` | `#1E1C24` |
| secondary `--sunken`, rail and case header `--surface-nav` | `#E9E6F0`, `#E4E0EC` | `#262330`, `#121117` |
| inspector `--surface-inspect` | `#F5F3F9` | `#1A1820` |
| text `--ink` / `--ink-2` | `#29272E` / `#696571` | `#ECE9F1` / `#BDB8C7` |
| actions `--accent` | `#6E5AA6` | `#B3A2E6` |
| selected `--accent-weak` | `#EAE3F7` | `#2C2740` |
| highlight `--peach` / `--peach-weak` | `#FFB478` / `#FFF0E1` | `#E8A070` / `#3A2A1C` |
| dividers `--line` | `#E6E2EB` | `#2E2B36` |

- Purple carries actions, the current nav item, selected rows, tabs, focus rings and the Proposed label.
  Peach carries "Case changed since", the flagged-approval box and changed work items in the demo. Status
  greens and reds are unchanged in meaning and still paired with labels.
- Hard-coded dark fills removed: the demo's "Matched · code" label is now white with a hairline, the
  matched record's border is purple, the dialog backdrop is a charcoal tint.
- The customer line keeps its canvas composition on the new page colour with a peach wash top-left and a
  lavender wash top-right; the assistant's rings are lavender when it speaks and peach when the customer does.
- Verified by screenshot on every route in light and dark: no dark panels, no large purple fills, no white
  text on pale accents.

## Contrast and functional colour (later the same day)

The user asked for more contrast, colour that differentiates element kinds, and a more digital, less
pastel register.

- Text `#1C1A21` / `#45414D` / `#625E6B`; lines `#D6D3DD` / `#B9B5C4`; page `#EAE9EE`; rail and case header
  `#D3D0DC`; section headers and chips `#DEDBE5`; radii 8 px cards, 6 px controls.
- One hue per kind, applied to marks, evidence chips (`data-kind` on `RefChip`), demo objects and the call
  rings: **customer statements** teal `#0B6E8A`; **bank records and code** charcoal on white, mono; **provider
  facts** dashed neutral; **the model** purple `#5A43A8` (also actions, selection, focus); **a person** green
  `#177A3E`; **changed since** amber `#F08A2E`; **blocking** red `#C4262E`.
- Dark mode mirrors the set (teal `#5FC3DE`, purple `#B3A2E6`).
- The customer line keeps its canvas with much quieter washes; the listening ring is teal, the speaking ring purple.

## Bellhop (later the same day)

The product is named Bellhop, with the user's mark (a smiling bellhop in a light red uniform with yellow accents, transparent
skin, circular). Source at the repo root; `public/bellhop.png` (512 px) and `app/icon.png` (128 px favicon) are resized
copies. It is the rail brand mark, the customer line brand, the figure inside the call rings (the drawn deer is gone) and the
avatar on the demo call surface. Titles read "Bellhop", "Bellhop · Claims" and "Bellhop · Demo".

