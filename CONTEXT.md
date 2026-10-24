# CONTEXT.md: current project state

> Living summary of where the project stands. **Update it with every revision**: change
> the sections below and add an entry to the revision log at the bottom.
> Details live in `docs/status.md` (checklist), `docs/integrations.md` (verified provider
> facts), `docs/architecture.md` (design), and `CLAUDE.md` (rules).

_Last updated: 2026-10-23_

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
| Voice (Cartesia) | 🟡 **Partial**: key, agent ID and tool secret set in Convex; backend endpoint live and secured. Webhook tool not registered; browser call client not built |
| Regulatory considerations | ✅ Curated official sources (Reg E and CFPB), scenario-scoped, no deadline math. 3 excerpts need word-for-word verification |
| Developer agent (Factory Droid) | ❌ Not started |
| Simulated reimbursement | ❌ Not started |
| Checks | ✅ `npm run verify`: typecheck, lint, 55 unit tests, production build all pass |

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
10. **Voice endpoint.** `POST <deployment>.convex.site/voice/tools/record-statement` is
    authenticated by `VOICE_TOOL_SECRET`. It's bound to one case by a backend-issued
    session token, ignores retried calls, and feeds the same workflow as text.

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
  - The live candidate is Bitdeer (OpenAI-compatible), pending your decision.
  - There's never a silent fallback to scripted mode.
- **CRS safety.**
  - Only CRS-published persona request bodies are sent, so no request is billable.
  - Logins are reused, and any failed login locks further attempts.

## What needs to be added (priority order)

1. **Cartesia voice**
   - Register the webhook tool with Cartesia and attach it to the agent (proposed: a backend
     action, so the secret never leaves the server).
   - Pass the session token as a dynamic variable when a call starts (method still
     unverified in Cartesia's docs).
   - Build the browser microphone and agent WebSocket client.
2. **Live reasoning.** Decide on Bitdeer, claim its credits, set the `REASONING_*`
   variables, and run the first live test.
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

- **Cartesia:** choose between registering the webhook tool from the backend (recommended)
  and doing it manually in the playground.
- **Reasoning:** decide whether to claim Bitdeer credits.
- **Factory:** API key and `droid` CLI install, when we reach that step.
- **Housekeeping:**
  - Rotate the CRS password at some point; it was pasted in chat.
  - Review and merge or push the `foundation` branch when ready (committed, not pushed).

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
