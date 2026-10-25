# Hackathon log

- **Project:** Bellhop
- **Event:** Cal Hacks 13.0
- **What it does:** Takes bank fraud claims by voice or text chat, checks each answer against synthetic bank records, and routes every claim to automatic approval (simulated payout), more questions, or a human reviewer.
- **Live app:** not deployed
- **Repo:** https://github.com/Happy-Key/Bellhop
- **Frontend:** not deployed
- **Convex deployment:** https://dynamic-chihuahua-120.convex.cloud (cloud dev; its site URL is in docs/integrations.md)
- **Components:** none
- **Convex features:** schema, indexes, queries, mutations, actions, HTTP actions, scheduled functions, realtime useQuery
- **Auth:** none
- **AI models:** zai-org/GLM-5.3-Flash via Bitdeer (set by `REASONING_MODEL`; named in docs/integrations.md)
- **Started:** 2026-10-24T00:50:57Z
- **Last updated:** 2026-10-25T08:42:45Z

## How we use Convex

- **Voice calls write into cases:** Cartesia's webhook tool posts each customer statement to an HTTP action that records it and returns the next question (`convex/http.ts`, `convex/intakeTurn.ts`).
- **Background reasoning:** a new statement schedules live extraction and a whole-case reassessment with `ctx.scheduler.runAfter`; approved payouts are scheduled the same way (`convex/statements.ts`, `convex/proposals.ts`).
- **External APIs only in actions:** Nessie, CRS, Bitdeer and Cartesia calls run in Convex actions, so keys stay in the Convex environment (`convex/nessie.ts`, `convex/crs.ts`, `convex/caseReasoning.ts`, `convex/voice.ts`).
- **One typed source of truth:** cases, statements, transactions, evidence, proposals, questions, voice sessions and the activity log are tables with indexes (`convex/schema.ts`).
- **Live screens, no refresh:** the claims queue `/review` (`components/review/ClaimsQueue.tsx`), the case workspace `/review/<id>` (`components/review/CaseReview.tsx`), the customer line `/call` with its case picker and "Thinking" state (`app/call/page.tsx`, `components/VoiceCall.tsx`), and the text chat (`components/TextChat.tsx`) all update through `useQuery`.

## Log

- 2026-10-24 `26c2663` Investigator foundation: schema, domain logic, case dashboard (`convex/schema.ts`, `lib/domain/`)
- 2026-10-24 `ed41f61` Cartesia webhook tool registration (`convex/voiceSetup.ts`, `lib/providers/cartesia.ts`)
- 2026-10-24 `f9bb26a` Browser voice call, call bound to a case (`components/VoiceCall.tsx`, `lib/voice/`)
- 2026-10-24 `7704ae2` Bitdeer statement extraction (`lib/providers/reasoning.ts`, `convex/statements.ts`)
- 2026-10-24 `129bf3a` Customer call page (`app/call/page.tsx`)
- 2026-10-24 `f7f5ee2` Claims workstation at /review (`components/review/`)
- 2026-10-24 `d997a82` AUTO-1 approval with simulated Nessie payout (`lib/domain/autoApproval.ts`, `convex/payoutData.ts`)
- 2026-10-24 `212c950` CRS identity and fraud-risk checks (`lib/providers/crs.ts`, `lib/domain/fraudSignals.ts`)
- 2026-10-24 `83361fe` Model decision proposals (`convex/proposals.ts`, `lib/domain/caseDecision.ts`)
- 2026-10-24 `49740a8` Demo personas (`convex/personas.ts`, `lib/fixtures/demoPersonas.ts`)
- 2026-10-24 `1c38656` Model-driven investigation (`lib/domain/investigation.ts`, `components/review/`)
- 2026-10-24 `a742dfb` Voice loop and call-ending fixes (`convex/voice.ts`, `components/VoiceCall.tsx`)
- 2026-10-24 `e6f5b60` Text chat and reviewer questions (`convex/chat.ts`, `convex/intakeTurn.ts`)
- 2026-10-24 `ba4625a` Bellhop UI redesign (`app/globals.css`, `app/review/review.css`)
- 2026-10-24 `5abd639` Reasoning timeout fix (`convex/caseReasoning.ts`, `lib/domain/investigation.ts`)
- 2026-10-24 `dadd3fd` Workstation status on the call page (`convex/review.ts`, `convex/cases.ts`)
- 2026-10-25 `42f2b19` Hotel-door backdrop (`components/shell/DoorBackdrop.tsx`)
- 2026-10-25 `3fa54bc` Thinking state; no question after a tool timeout (`convex/intakeTurn.ts`, `convex/voice.ts`)
- 2026-10-25 `3ebb03e` README for judges (`README.md`)
