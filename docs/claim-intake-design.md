# Design: US fraud claim intake, evidence preparation and adaptive voice

_Status: **proposal for review** (2026-10-24). Branch inspected: `foundation` at `f9bb26a`._

_Update 2026-10-24: the backend inconsistencies in A.3 that need no product decision are now fixed (mock-tested,
not live). Fixed: question keys and log, `question_id` voice flow, answers linked to questions, stale-attempt guard,
bounded wait, redaction, append-only evidence, correction targeting, spoken amounts, and the action-based
initiation question. Still open, pending section I: per-transaction fact model, access control, the 3-minute cap,
and Nessie deposits. Line references in A.3 refer to `f9bb26a`._

This is a claim-preparation and review workflow. It does not give legal advice, decide reimbursement,
or certify compliance. Every screen result here is a routing aid for a human.

**Labels used throughout**

| Label | Meaning |
|---|---|
| **[Code]** | Observed in code on this branch (path:line) |
| **[Source]** | Supported by an authoritative source; verification date given |
| **[Pack]** | Taken from the repo's own research pack (`legislative-reference/`), not re-verified in this session |
| **[Proposed]** | Proposed design |
| **[Confirm]** | Requires confirmation by you, counsel or a provider |

---

## A. Current-state findings

### A.1 Integrations that actually exist

| Name used in code | What it actually is | Role today | Notes |
|---|---|---|---|
| Nessie (`lib/providers/nessie.ts`) | Capital One's public **mock** banking API | Read-only purchases for one backend-bound demo account | Data is visible to all Nessie users; synthetic only |
| CRS (`lib/providers/crs.ts`) | **CRS Credit API** sandbox (StitchCredit), TransUnion *Identity Manager Verification – basic* | Identity-element check on 5 published **test personas** | **Not a CRM.** No CRM integration exists anywhere in the repo |
| Cartesia (`convex/voice.ts`, `convex/http.ts`, `lib/voice/`) | Cartesia **Managed Agent** (hosted LLM + STT/TTS) | Voice conversation; one webhook tool `record_statement` | Agent LLM runs the conversation only |
| Reasoning (`lib/providers/reasoning.ts`) | OpenAI-compatible chat endpoint; provider: Bitdeer (chosen 2026-10-24) | Live statement interpretation | **Not configured.** Scripted extractor is active |
| Factory | — | — | Not implemented |

### A.2 Verified characteristics (the ones you asked me to check)

| Claimed characteristic | Verdict | Evidence |
|---|---|---|
| Text and voice share one statement path | **True** [Code] | `convex/model.ts:87-134` `recordStatement`, called from `convex/cases.ts:60-77` (text) and `convex/voice.ts:61-81` (voice) |
| Corrections preserved through references | **True, with a weak auto-link** [Code] | `correctsRef` on insert (`model.ts:99-107`); originals never edited; field-level override in `lib/domain/facts.ts:41-56`. Auto-link always targets the *immediately previous* statement (`model.ts:104-106`) |
| Analysis recomputed from stored evidence | **True** [Code] | `recomputeAnalysis` (`model.ts:55-75`) after every write; pure `analyzeCase` (`lib/domain/workflow.ts:78-274`) |
| Live interpretation is asynchronous | **True** [Code] | `ctx.scheduler.runAfter(0, internal.reasoning.interpretLive, …)` (`model.ts:126-131`) |
| Voice webhook returns questions and recommendation | **True** [Code] | `convex/http.ts:58-64` returns `next_questions` (first 2 **blocking** question texts, `voice.ts:77`) and `recommended_action` |
| Nessie uses a backend-bound demo account | **True** [Code] | `cases.ts:40` and `cases.ts:90-100` bind `NESSIE_DEMO_ACCOUNT_ID`; `nessie.ts:22` never takes it from the client |
| CRS checks published sandbox personas only | **True** [Code] | Billing guard `lib/providers/crs.ts:96`; personas `lib/fixtures/crsPersonas.ts:28-59` |
| CRS and Nessie are separate synthetic datasets | **True** [Code] | `syntheticAssociation: true` on every CRS row (`crs.ts:125,136`); labelled in the activity log (`crsData.ts:34`) |
| Some analysis and findings are loosely structured | **True** [Code] | `cases.analysis: v.any()` (`convex/schema.ts:18`); `statements.proposedFindings: v.array(v.any())` (`schema.ts:35`); provider facts are `field/value` strings (`schema.ts:47-56`) |

Baseline: `npx vitest run` gives **74/74 passing** (run 2026-10-24).

### A.3 Map: file/function → behaviour → limitation → proposed change

| File / function | Current behaviour [Code] | Limitation | Proposed change [Proposed] |
|---|---|---|---|
| `lib/domain/schemas.ts:43-48` `AuthorizationClaim` | One case-level enum: `denies_authorization`, `authorized_induced`, `authorized`, `unspecified` | It stores a **legal conclusion** rather than the facts behind it. It is per case, not per transaction, and has no `not_asked`/`declined`/`not_applicable` | Replace with per-transaction **action facts** (`txn.entered_by`, `txn.customer_actions`, `txn.customer_belief`, `txn.prior_permission`). Coverage and "unauthorized" become rule outputs (§C, §F) |
| `lib/domain/workflow.ts:178` | Asks *"Did you make or approve this payment yourself (even if you were tricked into it), or was it made without your permission?"* | This is the legal-classification question the brief prohibits, and it conflates who sent the payment with permission | Remove it. Use question bank §E (`Q-INIT-1`, `Q-CODE-1`, …) |
| `lib/domain/workflow.ts:180-182` | The credential question is non-blocking and only asked after a denial | Never reaches voice (only blocking questions are returned, `voice.ts:77`). It also asks the customer to list secrets | Becomes `Q-CODE-1`. It asks what was shared **by type**, never the value |
| `lib/domain/facts.ts:83-87` | Different amounts in different statements are a conflict | Assumes **one disputed transaction**. Mixed incidents (three transfers) read as conflicts | Facts are attached to a `disputedTransactions` row. Conflicts are only computed within one subject |
| `lib/domain/workflow.ts:229-254` | Single `recommendation` (`request_clarification` / `further_investigation` / `escalate` / `reimbursement_review`) | Collapses intake state, reimbursement screening and legal screening into one value | Separate state machines (§B.2) and two versioned assessments (§C.3) |
| `lib/domain/workflow.ts:248-250` | Denial plus clear match gives `reimbursement_review` | Treats the customer's denial as enough. Rail, account purpose, who initiated, and notice timing are all unknown | Reimbursement screen requires the R-RT01 coverage facts. An unknown rail stays `needs_facts` |
| `convex/model.ts:104-106` | Text starting with "actually…" auto-corrects `S(n-1)` | Wrong target when the customer corrects an earlier statement, or answers an agent question | Correction targets a **fact** (`supersedes: factId`) chosen by the interpreter from the active facts, with the asked question as context |
| `convex/model.ts:112-121` | Statement text stored verbatim | A customer who reads out a card number or one-time code puts it in the database and the activity log | Redact-on-ingest: Luhn-valid PANs and code-like digit runs near "code/PIN/password" are replaced with `[REDACTED:<type>]` before insert. Store a flag, never the value |
| `convex/voice.ts:71-78` | Reads `c.analysis` right after `recordStatement` | **In live mode the new statement is still `interpretation: null`**, so the returned questions ignore what the customer just said. This is the stale-question bug | Bounded synchronous turn (§E.4) |
| `lib/domain/idempotency.ts:14-17` | Voice key = hash(call, normalized utterance) | "Yes." to question 1 and "Yes." to question 2 are deduplicated (documented in `docs/integrations.md`) | Key = hash(call, issued question ID, normalized utterance). A retried webhook still dedupes; the same words to a different question do not |
| `convex/http.ts:58-64` | Returns question **texts**, not IDs; nothing records that a question was asked | Root cause of the repetition seen live (CONTEXT.md, S1–S7) | `intakeTurns` table logs every issued question; the response carries `question_id` and `state_version` |
| `convex/statements.ts:24-44` `applyInterpretation` | Patches whatever result arrives | No attempt ID. A `retryLive` race lets an older or failed attempt overwrite a newer one (`markInterpretationFailed` can land after a success) | `interpretationAttempts` with `attemptId`; apply only if it is the statement's current attempt |
| `convex/cases.ts:108-109` `storeTransactions` | Patches existing transaction rows in place | Loses observation history (pending → posted → reversed) | Append observation snapshots; the current row points to the latest |
| `convex/crsData.ts:21-27, 99-100` | Re-linking a persona **deletes** earlier CRS rows | Destroys provenance | Mark rows `supersededAt`; hide them from the current view |
| `lib/providers/nessie.ts:141-156` | Only `GET /accounts/{id}/purchases`; `kind` is always `purchase` | No deposits or withdrawals, so no visibility of credits or reversals. No time of day, no rail. `medium` is Nessie's funding medium, not a payment rail | Add read-only deposits and withdrawals retrieval (the endpoints are in the Nessie spec; field shapes **[Confirm]** by probe). Never infer the rail from `medium` |
| `lib/domain/interpret.ts:32-41, 44-83` | Amounts need `$` or "dollars"; dates resolved in **UTC** | Spoken amounts are missed (CONTEXT.md). Customer time zone is ignored, so "yesterday" near midnight is wrong | Spoken-number parser; dates carry precision and the claimant's time zone |
| `convex/schema.ts:7-21` `cases` | No tenant, no owner, `synthetic: v.literal(true)` | No access control (A.4) | Add `tenantId`, `environment`, `caseMembers` |
| `components/VoiceCall.tsx:20` | `MAX_CALL_SECONDS = 180` | An adaptive intake cannot finish in 3 minutes | Raise the cap after a budget decision (§I). Intake must be resumable across calls and text |
| `lib/domain/regulatory.ts` | 8 curated sources, scenario-scoped, no deadlines | Narrow. CLAUDE.md forbids automatic edits | Keep it as the citable-excerpt store. Add a separate, human-reviewed **rule registry** (§F) |
| `legislative-reference/` | Overview plus a 35-rule CSV (`R-RT01` … `R-V02`) citing facts `F01`–`F42` and sources `S01`–`S67` | **The fact checklist (tab C), source register (tab A), form field map (D), deadline tables (E) and gray areas (F) are not in the repo**, so `F`/`S` IDs cannot be resolved | Import the CSV as the starting rule registry. Ask for the missing tabs (§I) |

### A.4 Access control today [Code]

- **No user authentication.** `cases.list` (`cases.ts:7-13`) returns every case to any caller. `cases.view`
  (`cases.ts:15-34`) returns everything for any case ID. `voice.createVoiceSession`, `crsData.linkPersona`,
  `statements.retryLive` and `nessie.retrieveBankEvidence` are all public. This is documented as acceptable
  for synthetic data (`docs/architecture.md`, Security boundaries).
- **Good existing boundaries:** the voice tool needs a bearer secret plus a backend-issued session bound to
  one call (`voice.ts:44-58`). Idempotency keys refuse cross-case reuse (`model.ts:90`). Correction targets
  are looked up within the case (`model.ts:102`).

---

## B. Proposed first-release scope

### B.1 Routes

| Route | v1 support | Why |
|---|---|---|
| **R1** Consumer deposit/prepaid account, Reg E rail, **someone other than the customer entered and sent** (account takeover, stolen card or credentials, code obtained by deception) | **Full**: intake, evidence comparison, reimbursement screen, notice draft, schedule, tasks | Clearest rule set (12 CFR 1005.2(m), comment 2(m)-3, CFPB FAQ Unauthorized EFTs Q5–Q6) [Source] |
| **R2** Consumer account, Reg E rail, **customer entered and sent** after deception (impostor, purchase, romance, investment) | **Full intake and legal screen; reimbursement screen limited to named non-statutory routes** (Zelle imposter policy, incorrect-EFT check, institution scam review) | No federal reimbursement right under the current 1005.2(m) text [Pack R-E03]. Must not be reported as "denied" |
| **R3** Mixed incident (some transfers sent by the customer, some by the scammer) | **Full**, per transaction | Common in code-sharing scams. Each transaction routes separately |
| **R4** Unclear who pressed send (remote access, shared device) | **Intake plus human review**; both screens marked `needs_facts` | The CFPB FAQ does not address remote control directly (verified 2026-10-24) [Source] |
| **R5** Credit card (Reg Z unauthorized use / billing error) | **Intake and routing only**; written-notice reminder; no letter template in v1 | Distinct rules: 1026.12(b), 1026.13 [Pack]. Written notice is needed for billing-error rights [Pack R-Z03] |
| Wire (Fedwire/CHIPS/bank wire), check, business account, brokerage, remittance, crypto ATM, gift card redemption, cash | **Specialist review**: collect the narrative and transaction facts, then stop routing | Different law (UCC 4A, Reg J, UCC 3/4, FINRA, 1005.33) that varies by state or forum [Pack]. Never silently rejected |
| Anyone acting for the customer without documented authority; signs the claimant may have shared in proceeds | **Human review** | 1005.2(m) exclusions need judgement [Source] |

### B.2 Outcomes as separate state machines [Proposed]

```
Intake            not_started → in_progress ⇄ needs_clarification → complete
                  (flag, not a state: urgent_actions_open = true|false)

Per institution   none → potential_route → ready_for_submission → submitted →
dispute           under_investigation → determined{approved_full|approved_partial|denied|withdrawn}
                  → reconsideration_requested → determined…
                  (ready_for_submission requires human approval of the draft AND customer confirmation)

Money             derived from recovery events, never set by hand:
                  none | provisional_only | partial_final | full_final  (+ provisional_reversed)

Legal screen      not_screened → insufficient_information → {not_indicated_now | ready_for_attorney_review}
                  → referred → {accepted | declined}

Case              open → closed{reason, outcome summary, closed_by(human), closed_at}
```

- A case closes only by a human action that cites the money state and the dispute determinations. A
  recommendation never closes it.
- "Potential reimbursement route identified" is a reimbursement-screen output (§C.3), not a dispute state.

### B.3 Artifacts (all drafts, all labelled)

Dispute notice draft (customer-voice), transaction schedule, evidence index, customer narrative, follow-up
or reconsideration request, attorney-review packet. Each carries `requirementsVerified: false` until
someone checks that institution's form and address. Sandbox-sourced artifacts get a fixed watermark:
*"SANDBOX DATA. Cannot substantiate a real claim."*

---

## C. Claim-model specification

### C.1 Principles

1. **Facts are rows, insert-only.** Corrections insert a new fact that `supersedes` the old one.
2. **Answer state is explicit:** `answered | unknown | declined | not_applicable`. **`not_asked` is the
   absence of an active fact** (plus no `intakeTurns` entry), so it is never stored as a value.
3. **Source kind is explicit:** `customer_reported | provider_observed | document_supported |
   reviewer_assessed | system_derived`.
4. **Legal conclusions are never facts.** They live in assessments, are versioned, and cite rule IDs.
5. **Money is integer minor units plus an ISO currency.** Dates carry precision and time zone.
6. **Every row carries `caseId`** and is reached only through `requireCaseAccess`.

### C.2 Convex validators (sketch for `convex/schema.ts`)

```ts
// convex/validators.ts (additions)
export const answerState = v.union(v.literal("answered"), v.literal("unknown"), v.literal("declined"), v.literal("not_applicable"));
export const sourceKind = v.union(v.literal("customer_reported"), v.literal("provider_observed"),
  v.literal("document_supported"), v.literal("reviewer_assessed"), v.literal("system_derived"));
export const environment = v.union(v.literal("sandbox"), v.literal("production"));
export const money = v.object({ minor: v.number() /* integer, checked in domain */, currency: v.string() /* ISO 4217 */ });
export const partialDate = v.object({
  value: v.string(),                       // "2026-10-21" | "2026-10" | "2026"
  precision: v.union(v.literal("day"), v.literal("month"), v.literal("year"), v.literal("approximate")),
  timeZone: v.optional(v.string()),        // IANA, from the claimant
  instant: v.optional(v.number()),         // epoch ms when a time of day is known
});
export const factValue = v.union(
  v.object({ t: v.literal("enum"), v: v.string() }),        // checked against the fact registry
  v.object({ t: v.literal("enums"), v: v.array(v.string()) }),
  v.object({ t: v.literal("bool"), v: v.boolean() }),
  v.object({ t: v.literal("money"), v: money }),
  v.object({ t: v.literal("date"), v: partialDate }),
  v.object({ t: v.literal("text"), v: v.string() }),        // narratives stay text
  v.object({ t: v.literal("ref"), v: v.string() }),         // T:…, D:…, S…
);
export const subject = v.union(v.literal("case"), v.literal("claimant"), v.literal("account"),
  v.literal("incident"), v.literal("transaction"), v.literal("dispute"));
```

```ts
// convex/schema.ts (new tables; all existing tables are kept)
cases: defineTable({ /* existing fields */
  tenantId: v.optional(v.string()),        // optional during migration, then required
  environment: v.optional(environment),    // existing rows backfilled to "sandbox"
  intakeStatus: v.optional(v.string()),    // see B.2
  urgentActionsOpen: v.optional(v.boolean()),
  closed: v.optional(v.object({ at: v.number(), by: v.string(), reason: v.string() })),
}),

caseMembers: defineTable({ tenantId: v.string(), caseId: v.id("cases"), userId: v.string(),
  role: v.union(v.literal("claimant"), v.literal("representative"), v.literal("reviewer"), v.literal("attorney")),
  grantedAt: v.number(), revokedAt: v.optional(v.number()) })
  .index("by_user_case", ["userId", "caseId"]).index("by_case", ["caseId"]),

accounts: defineTable({ caseId: v.id("cases"), label: v.string(),           // "Checking at Demo Bank"
  institutionName: v.optional(v.string()), last4: v.optional(v.string()),
  providerBinding: v.optional(v.object({ provider: v.literal("nessie"), environment })), // ID itself stays server-side on cases
  createdAt: v.number() }).index("by_case", ["caseId"]),

incidents: defineTable({ caseId: v.id("cases"), label: v.string(), createdAt: v.number() }).index("by_case", ["caseId"]),

disputedTransactions: defineTable({ caseId: v.id("cases"), incidentId: v.id("incidents"),
  accountId: v.optional(v.id("accounts")), ordinal: v.number(),            // "payment 2"
  matchedTxnRef: v.optional(v.string()),                                    // T:… once confirmed
  status: v.union(v.literal("active"), v.literal("withdrawn_by_customer"), v.literal("merged")),
  createdAt: v.number() }).index("by_case", ["caseId"]),

facts: defineTable({ caseId: v.id("cases"), subjectType: subject, subjectId: v.string(),
  key: v.string(),                         // registry key, e.g. "txn.entered_by"
  state: answerState, value: v.optional(factValue),
  source: sourceKind, sourceRefs: v.array(v.string()),                      // S4, T:…, D:…, X:…
  environment,                             // sandbox facts can never support a production assessment
  extractor: v.optional(v.object({ mode: v.string(), provider: v.string(), attemptId: v.optional(v.string()) })),
  inResponseTo: v.optional(v.string()),    // question ID
  needsConfirmation: v.boolean(), confirmedBy: v.optional(v.string()),     // S-ref of confirming answer
  supersedes: v.optional(v.id("facts")), supersededBy: v.optional(v.id("facts")),
  createdAt: v.number() })
  .index("by_case", ["caseId"])
  .index("by_case_subject_key", ["caseId", "subjectType", "subjectId", "key"])
  .index("by_case_active", ["caseId", "supersededBy"]),

documents: defineTable({ caseId: v.id("cases"), ref: v.string() /* D1… */, storageId: v.id("_storage"),
  docType: v.string(), uploadedBy: v.string(), receivedAt: v.number(), sha256: v.string(), environment,
  containsSensitive: v.boolean(), supersedes: v.optional(v.id("documents")) })
  .index("by_case", ["caseId"]).index("by_case_ref", ["caseId", "ref"]),

institutionDisputes: defineTable({ caseId: v.id("cases"), accountId: v.optional(v.id("accounts")),
  transactionIds: v.array(v.id("disputedTransactions")), routeId: v.string(),
  state: v.string() /* B.2 */, institutionClaimRef: v.optional(v.string()), createdAt: v.number() })
  .index("by_case", ["caseId"]),

correspondence: defineTable({ caseId: v.id("cases"), disputeId: v.id("institutionDisputes"),
  direction: v.union(v.literal("to_institution"), v.literal("from_institution")),
  kind: v.string() /* notice | written_confirmation | acknowledgment | provisional_credit_notice | determination | info_request | reversal_notice */,
  date: partialDate, channel: v.string(), documentId: v.optional(v.id("documents")), source: sourceKind })
  .index("by_dispute", ["disputeId"]).index("by_case", ["caseId"]),

recoveryEvents: defineTable({ caseId: v.id("cases"),
  kind: v.union(v.literal("provisional_credit"), v.literal("provisional_reversal"), v.literal("final_credit"),
    v.literal("merchant_refund"), v.literal("network_chargeback"), v.literal("recipient_return"),
    v.literal("goodwill"), v.literal("other")),
  amount: money, date: partialDate,
  allocations: v.array(v.object({ transactionId: v.id("disputedTransactions"), amount: money })),
  replaces: v.optional(v.id("recoveryEvents")),   // final credit replaces a provisional credit; never summed twice
  source: sourceKind, sourceRefs: v.array(v.string()), environment })
  .index("by_case", ["caseId"]),

assessments: defineTable({ caseId: v.id("cases"),
  kind: v.union(v.literal("reimbursement_screen"), v.literal("legal_review_screen")),
  version: v.number(), ruleSetVersion: v.string(), inputFactIds: v.array(v.id("facts")),
  inputsHash: v.string(), result: v.any() /* validated by zod in lib/domain/assessments.ts */,
  sandboxOnly: v.boolean(), computedAt: v.number(), current: v.boolean(),
  review: v.optional(v.object({ by: v.string(), at: v.number(), decision: v.string(), note: v.string() })) })
  .index("by_case_kind_current", ["caseId", "kind", "current"]),

tasks: defineTable({ caseId: v.id("cases"), kind: v.string(),
  basis: v.union(v.literal("statutory"), v.literal("institution_procedure"), v.literal("internal")),
  ruleId: v.optional(v.string()), triggerFactIds: v.array(v.id("facts")),
  dueEstimate: v.optional(partialDate), calculation: v.string(),   // human-readable working, incl. business-day assumptions
  estimateConfidence: v.union(v.literal("trigger_verified"), v.literal("trigger_reported"), v.literal("trigger_unknown")),
  assigneeRole: v.string(), status: v.string(), createdAt: v.number() })
  .index("by_case", ["caseId"]),

artifacts: defineTable({ caseId: v.id("cases"), kind: v.string(), version: v.number(),
  inputFactIds: v.array(v.id("facts")), storageId: v.optional(v.id("_storage")), body: v.optional(v.string()),
  status: v.union(v.literal("draft"), v.literal("reviewer_approved"), v.literal("customer_confirmed"), v.literal("submitted_by_customer")),
  requirementsVerified: v.boolean(), sandboxWatermark: v.boolean(), createdAt: v.number() })
  .index("by_case", ["caseId"]),

intakeTurns: defineTable({ caseId: v.id("cases"), sessionId: v.optional(v.id("voiceSessions")),
  questionId: v.string(), subjectId: v.optional(v.string()), wording: v.string(),
  issuedAt: v.number(), stateVersion: v.number(),
  outcome: v.optional(v.union(v.literal("answered"), v.literal("unknown"), v.literal("declined"),
    v.literal("deflected"), v.literal("superseded"))), answerRef: v.optional(v.string()) })
  .index("by_case", ["caseId"]).index("by_session", ["sessionId"]),

interpretationAttempts: defineTable({ caseId: v.id("cases"), statementId: v.id("statements"),
  attemptId: v.string(), mode: v.string(), startedAt: v.number(),
  status: v.union(v.literal("pending"), v.literal("applied"), v.literal("discarded_stale"), v.literal("failed")),
  error: v.optional(v.string()) }).index("by_statement", ["statementId"]),
```

Notes:

- `statements` stay as they are (verbatim evidence), plus `inResponseTo`, `redactions`, and
  `currentAttemptId`.
- `transactions` and `providerEvidence` gain `environment` and `supersededAt`.
- The Nessie account ID stays on `cases.nessieAccountId` (backend-bound). `accounts.providerBinding` only
  records *that* a binding exists.
- **Indexes cover every access path** used by question selection (`by_case_subject_key`), assessment
  lookup (`by_case_kind_current`) and the dashboard (`by_case`). There are no table scans.
- **Access:** a new `convex/access.ts` `requireCaseAccess(ctx, caseId, capability)` is called first in every
  public query, mutation and action. Capabilities are `read`, `add_statement`, `upload`, `review`,
  `close` and `attorney_read`. The voice HTTP path gets a narrow capability (`add_statement` for the bound
  case only) from its session. Every ref passed in (`S…`, `T:…`, `D…`) is resolved with a `caseId`-scoped
  index, never by global lookup.

### C.3 Assessment result shapes (zod, `lib/domain/assessments.ts`)

```ts
ReimbursementScreen = {
  overall: "intake_incomplete" | "potential_route_identified" | "specialist_review_required"
         | "no_route_identified_under_screened_rules",           // never "denied" or "approved"
  perTransaction: [{
    transactionId, coverage: "reg_e_eft" | "reg_z_credit" | "wire" | "check" | "brokerage" | "remittance" | "unknown",
    routes: [{ routeId, ruleIds: string[], status: "potential" | "needs_facts" | "unlikely_under_current_text" | "specialist",
               blockingFactKeys: string[], supportingFactIds: string[] }],
  }],
  urgentActions: string[], caveats: string[],
}

LegalReviewScreen = {
  status: "insufficient_information" | "not_indicated_now" | "ready_for_attorney_review" | "specialist_referral",
  potentialDefendants: [{ type: "account_institution" | "p2p_provider" | "receiving_institution" | "recipient" | "merchant",
                          basisRuleIds: string[], supportingRefs: string[], missing: string[] }],
  timing: { earliestTaskId?: string, basis: string },          // e.g. EFTA 1-year from violation (R-E15)
  forumNotes: string[],                                        // arbitration clause unknown, FINRA, small claims
  collectability: "unknown" | "factors_noted", proportionality: { lossMinor: number, note: string },
  alternativeRemedies: string[],                               // CFPB complaint, state AG, regulator
}
```

The **loss figure** is computed once in `lib/domain/recovery.ts`. Claimed amount minus *final* allocations
gives the outstanding amount. A provisional credit is shown separately and is never subtracted twice: a
`final_credit` with `replaces` cancels its provisional credit.

### C.4 Field specification (core fields)

`Sens` = sensitivity tier: **1** case facts, **2** personal data, **3** financial identifiers or third-party
data, **X** never stored (redacted on ingest).

| Key (type) | Purpose | Source | When | Route need | Sens | Uncertainty and correction | Used by |
|---|---|---|---|---|---|---|---|
| `consent.recording` (enum granted/declined) | All-party consent before substantive questions | system + customer | Call start | All | 1 | `declined` switches to no-record mode or a human | R-V01, call flow |
| `claimant.role` (enum account_holder/joint/authorized_user/representative/other) | Standing; 1005.2(m) "furnished" analysis | customer → document | Early | All | 2 | `unknown` triggers human review if representative | R-E01, packet |
| `claimant.rep_authority` (enum poa/guardian/executor/informal/none) | A representative can give notice (comment 6(b)(5)) [Pack] | document_supported | If representative | All | 2 | Unverified until a document is uploaded | R-E08, packet |
| `claimant.state` (enum US state) | State-law routes; recording consent | customer | Early | Wire/check/consent | 2 | `declined` is allowed | R-V01, R-W*, R-K01 |
| `account.purpose` (enum personal_household/business/mixed) | Reg E covers consumer accounts | customer → provider | Early | R1–R3 | 1 | `mixed` or `unknown` goes to specialist | R-RT01 |
| `account.product` (enum checking/savings/prepaid/credit_card/brokerage/p2p_balance/other) | Selects the rule family | customer → provider | Early | All | 1 | Provider value wins if it disagrees, then confirm | R-RT01, R-E14, R-Z*, R-F01 |
| `account.opened_recently` (bool: first deposit within 30 days) | 20/90-day investigation periods (1005.11(c)(3)) [Source] | customer → provider | Late, low priority | R1 | 1 | `unknown` assumes the standard period, labelled | tasks |
| `incident.narrative` (text refs) | Preserve the customer's account in their words | customer | First | All | 1 | Never overwritten | narrative artifact |
| `incident.first_contact_at` (partialDate) | Timeline | customer | Early | R2, R3 | 1 | Precision kept; ranges allowed | timeline |
| `incident.contact_channel` (enums phone/sms/email/social/website/app/in_person) | Scam mechanism | customer | Early | R2, legal | 1 | Multi-valued | packet, R-P01 |
| `incident.claimed_identity` (enum own_bank/other_bank/government/business/tech_support/family_friend/romance/investment/employer/none) | Impostor routes (Zelle policy covers impostors of banks, businesses, government) [Pack R-P01] | customer | Early | R2 | 1 | `unknown` is allowed | R-P01 |
| `incident.remote_access` (enum yes_still_installed/yes_removed/no/unknown) | Who could have pressed send; urgency | customer | Triggered | R4 | 1 | `unknown` keeps R4 open | R4, urgent flow |
| `incident.disclosed_types` (enums otp/password/pin/card_number/card_security_code/security_answers/device/none) | Induced-sharing analysis (FAQ Q5–Q6) [Source] | customer | Triggered | R1, R3 | 1 (the values are **X**) | Type only. The value is redacted if spoken | R-E02 |
| `incident.code_belief` (text) | What the customer believed a code or approval was for | customer | After a code is disclosed | R1, R3 | 1 | Free text, never classified by the customer | R-E02, narrative |
| `urgent.*` (bool: still_in_contact, account_accessible_to_other, card_active, pending_transfers) | Safety first | customer | P0 | All | 1 | Asked once; re-asked on new signals | urgent actions |
| `txn.amount_reported` (money) | Identify and quantify | customer | Per transaction | All | 1 | Confirmed by read-back | matching, schedule |
| `txn.date_reported` (partialDate) | Identify; timing triggers | customer | Per transaction | All | 1 | Precision kept | matching, tasks |
| `txn.recipient_reported` (text) | Identify; legal defendants | customer | Per transaction | All | 3 | Never echoed into other cases | matching, legal |
| `txn.rail_reported` (enum card/zelle/other_p2p/ach/wire/check/atm/bill_pay/crypto_atm/gift_card/cash/unknown) | Rule family | customer → provider | Per transaction | All | 1 | Provider observation supersedes, with a discrepancy note | R-RT01 |
| `txn.entered_by` (enum customer/other_person_own_device/other_person_customer_device/other_person_remote_control/unknown) | **The deciding fact** (1005.2(m) "initiated by a person other than the consumer") [Source] | customer | Per transaction, confirmed | R1–R4 | 1 | `unknown` → R4. Confirmed by read-back | R-E01–E03 |
| `txn.customer_actions` (enums entered_details/pressed_send/approved_prompt/read_code/none) | Action facts behind `entered_by` | customer | Per transaction | R1–R4 | 1 | Multi-valued | R-E02/E03 |
| `txn.customer_belief` (text) | What the customer thought the payment was for | customer | If the customer sent it | R2 | 1 | Free text | R-E04, narrative |
| `txn.prior_permission` (enum none/limited/unlimited) + `txn.permission_scope` (text) | 2(m)-2 "authority exceeded" [Source] | customer | If the other person is known to the customer | R1 | 1 | `limited` requires a scope | R-E01 exception |
| `txn.permission_revoked_notice_at` (partialDate) | 2(m)-2 notice to the institution | customer → correspondence | If prior permission | R1 | 1 | — | R-E01 |
| `txn.benefit_received` (enum none/some/unknown) | 1005.2(m) "no benefit" | customer | Per transaction, late | R1 | 1 | Asked neutrally; `unknown` is acceptable | R-E01 |
| `txn.matched_ref` (ref T:…) | Link to the provider record | system → customer confirms | After retrieval | All | 1 | A tentative match needs customer confirmation | comparison |
| `notice.first_reported_at` (partialDate) | Starts the institution's error-resolution clock (1005.11(c)) [Source] | customer → correspondence | P5 | R1, R2 | 1 | Reported vs document-supported kept apart | tasks, legal |
| `notice.channel` / `notice.reported_to` (enum) | 1005.6(b)(5) reasonable means; P2P vs bank [Source/Pack] | customer | P5 | R1 | 1 | — | R-E08, R-RT02 |
| `notice.written_confirmation_requested` (bool) + `_sent_at` | 10-business-day confirmation (1005.11(b)(2)) [Pack] | customer → doc | After notice | R1 | 1 | — | tasks |
| `notice.statement_date` (partialDate) | 60-day trigger (1005.11(b)(1), 1005.6(b)(3)) [Source] | document_supported preferred | P5 | R1 | 1 | A reported value is `trigger_reported` only | tasks |
| `loss.device_loss_learned_at` (partialDate) | Two-business-day tier (1005.6(b)(1)) [Source] | customer | If a card/device was lost or stolen | R1 | 1 | — | tasks, liability note |
| `dispute.institution_requirements` (enums affidavit/police_report/notarized/merchant_contact_first) | Institution may not delay investigation pending documents (FAQ Error Resolution Q4) [Source] | customer → correspondence | After submission | R1, legal | 1 | — | legal screen |
| `dispute.determination` (enum) + `reason_text` | Outcome history | correspondence | After determination | All | 1 | Document wins over report | legal screen, closing |
| `recipient.identifiers` (text: handle or bank name only) | Recovery request; potential defendant | customer | Late | R2, legal | 3 | Restricted to reviewer and attorney | legal packet |

**Not collected:** income, credit score, unrelated assets, SSN, full account or card numbers, passwords,
codes. Age and vulnerability are **not** collected in v1 (§I).

---

## D. Field → question → evidence → analysis → artifact

| Field | Question | Evidence compared | Analysis that uses it | Artifact |
|---|---|---|---|---|
| `urgent.*` | Q-URG-1/2 | — | Urgent actions list (not eligibility) | Safety checklist shown immediately |
| `incident.narrative` | Q-OPEN | — | Interpreter seeds the other fields | Customer narrative |
| `txn.amount_reported`, `date`, `recipient` | Q-TXN-1/2/3 | Nessie `amount`, `purchase_date`, merchant `name` | Matching (existing `matching.ts`, per transaction) | Transaction schedule |
| `txn.rail_reported` | Q-RAIL-1 | Nessie has **no rail field**; statement or document | R-RT01 coverage | Schedule column; routing note |
| `account.purpose`, `account.product` | Q-ACCT-1/2 | Nessie account `type` (checking etc.); purpose not available | R-RT01, specialist gates | Notice header |
| `txn.entered_by`, `customer_actions` | Q-INIT-1/2, Q-RA-1 | **No provider access evidence exists** (no device, IP or session data) | R-E01/E02/E03 routing | Narrative, notice ("I did not initiate…" only if confirmed) |
| `incident.disclosed_types`, `code_belief` | Q-CODE-1/2 | — | R-E02 induced-sharing analysis | Narrative |
| `txn.prior_permission` | Q-PERM-1 | — | 2(m)-2 exception | Reviewer note |
| `notice.*` | Q-NOT-1/2/3 | Correspondence documents | 1005.11 timelines; tasks | Notice draft, follow-up letter |
| Recovery events | Q-REC-1 | Nessie deposits (**[Confirm]** shape); documents | Outstanding loss | Schedule (claimed / provisional / final / outstanding) |
| `dispute.institution_requirements`, determination | Q-INST-1/2 | Letters | Legal screen triggers (R-E10, R-E12, R-E13, R-E15) | Attorney packet |
| `recipient.identifiers` | Q-RCPT-1 | Nessie merchant | Legal screen, recall request | Attorney packet; ACH/Zelle recovery request |

---

## E. Adaptive voice flow

### E.1 Who decides what

- **Backend:** claim state, which question is next, its plain-language wording, urgency, and whether
  intake is complete.
- **Cartesia agent:** speaks the question naturally, records the customer's words verbatim, does not
  classify, promise or advise, and offers secure upload and a human.

### E.2 Question bank (excerpt; full bank in `lib/domain/intake/questions.ts`)

Priority: P0 safety, P1 narrative, P2 identify transactions, P3 initiation, P4 credentials and permission,
P5 reporting, P6 recoveries, P7 account, P8 legal-screen facts.

| ID | Targets | Wording | Trigger | Pri | Skip if | Follow-ups | Confirm? | Why |
|---|---|---|---|---|---|---|---|---|
| Q-CONSENT | consent.recording | "This call is with an automated assistant and is recorded and transcribed to prepare your claim. Is that okay?" | Call start | P0 | Granted this session | Declined → no-record mode or human | — | All-party consent approach [Pack R-V01] |
| Q-OPEN | narrative | "Please tell me what happened, starting with when you were contacted or first noticed a problem." | No narrative | P1 | Narrative exists | Interpreter fills fields | — | Collect facts before categories |
| Q-URG-1 | urgent.still_in_contact, remote_access | "Is anyone still on the phone with you, or connected to your phone or computer, right now?" | Narrative mentions a caller, remote access or an ongoing chat; or not yet asked | P0 | Answered | Yes → urgent script: "Please end that contact now; I'll wait." | — | Stop ongoing loss |
| Q-URG-2 | urgent.account_accessible_to_other, card_active, pending_transfers | "Have you been able to contact your bank to lock your account or card yet?" | Not yet reported | P0 | `notice.first_reported_at` exists | No → give the bank's number from the card or statement; continue intake after | — | Don't delay urgent action |
| Q-TXN-1 | txn.amount_reported (+count) | "How many payments are you concerned about, and roughly how much was each?" | No transactions | P2 | — | One row per payment | **Yes**: read back amounts | Identify |
| Q-TXN-2 | txn.date_reported | "When did the {ordinal} payment for {amount} happen? An approximate date is fine." | Per transaction | P2 | Date with day precision | — | Yes | Match; triggers |
| Q-RAIL-1 | txn.rail_reported | "How did that money leave your account: a debit card, an app like Zelle, a bank transfer, a wire, a check, or something else?" | Per transaction | P2 | Provider rail known | "Wire" → specialist note | — | Coverage |
| **Q-INIT-1** | txn.entered_by, customer_actions | "Did you personally enter and send the {amount} payment, or did someone else do that?" | Per transaction, `entered_by` unknown | P3 | Answered and confirmed | "Someone else" → Q-INIT-2; "me" → Q-BELIEF-1; "not sure" → Q-RA-1 | **Yes** | Deciding fact |
| Q-INIT-2 | txn.entered_by detail | "Do you know whether they used their own device, or your phone or computer?" | Other person | P3 | — | Customer device → Q-RA-1 | — | Remote control vs own device |
| Q-RA-1 | incident.remote_access | "Did anyone ask you to install an app or share your screen?" | Not sure who sent; tech-support or bank impostor | P3 | Answered | Yes → "Did you see the mouse or screen moving on its own when the payment was made?" | — | R4 |
| **Q-CODE-1** | incident.disclosed_types | "Before this payment, did you give anyone a code, a password, or card details, for example by reading out a code that was texted to you? Please don't tell me the code or number itself, just what kind it was." (2026-10-24: was "did anyone ask you for…"; being asked and refusing isn't sharing, and AUTO-1 checks what was given) | Impostor or takeover signals | P4 | Answered | Code → Q-CODE-2 | — | R-E02 |
| **Q-CODE-2** | incident.code_belief | "What did they tell you the code would do?" | A code was disclosed | P4 | Answered | — | — | Induced vs furnished |
| Q-BELIEF-1 | txn.customer_belief | "What did you understand that payment was for, or who did you believe you were paying?" | Customer sent it | P3 | Answered | Impostor → Q-IMP-1 | — | R2 routes |
| Q-IMP-1 | incident.claimed_identity | "Who did they say they were?" | Contact by a person | P4 | Answered | — | — | R-P01 |
| Q-PERM-1 | txn.prior_permission, scope | "Had you ever let this person use your card or account before? If so, what were they allowed to do?" | The other person is known (family, caregiver) | P4 | — | Limited → scope | — | 2(m)-2 |
| Q-NOT-1 | notice.first_reported_at, channel, reported_to | "When did you first tell your bank or the payment app, and how: by phone, in the app, or in writing?" | Not reported | P5 | — | "Not yet" → urgent prompt | Yes (date) | 1005.11 clock |
| Q-NOT-2 | notice.written_confirmation_requested | "Did they ask you to send anything in writing, like a form or affidavit?" | Reported | P5 | — | Q-INST-1 | — | 10-business-day confirmation |
| Q-REC-1 | recovery events | "Has any money been put back in your account, even temporarily?" | Reported | P6 | — | Amount and date per credit; "temporary or final?" | Yes (amounts) | Avoid double counting |
| Q-ACCT-1 | account.purpose | "Is this a personal account, or one used for a business?" | Unknown | P7 | Provider says personal | Business → specialist | — | Reg E consumer scope |
| Q-INST-1 | dispute.institution_requirements | "Did the bank say it couldn't start looking into this until you provided anything, like a police report?" | Submitted | P8 | — | — | — | FAQ Error Resolution Q4 |
| Q-INST-2 | dispute.determination | "Have you received a decision letter? If so, you can upload it with the secure link I'll send." | After submission | P8 | Letter uploaded | — | — | Legal screen |
| Q-DOCS | — | "I can send you a secure link to upload statements, letters or screenshots after this call. Would you like that?" | Once per session | P8 | Sent | — | — | Keep documents off the call |
| Q-HUMAN | — | (Any time) "Would you like to speak with a person?" | Customer distress, repeated `unknown`, or request | P0 | — | Hand-off task | — | Escalation |

### E.3 Selection algorithm (`selectNextQuestion(state)`, pure)

1. Candidates are questions whose trigger is true and whose target facts have **no active fact** (any
   answer state counts as answered).
2. Drop anything issued **twice** this session without an answer (`intakeTurns.outcome = deflected`). It
   goes to a reviewer list instead of being asked a third time.
3. Material values (amount, date, `entered_by`) that are `needsConfirmation` produce a **read-back**
   question before any new question at the same priority.
4. Conflicts between active facts for the same subject and key produce a neutral clarification: "Earlier
   I noted {A}, and just now {B}. Which is right, or were these different payments?" (the second option
   avoids forcing a conflict when there are really two transactions).
5. Sort by priority, then by route impact (does the answer change a route status?), then by subject
   ordinal.
6. P0 questions **preempt** everything. Urgent answers immediately return `urgent_notice` text alongside
   the next question, so urgent action is never held until intake ends.
7. Intake is `complete` when no candidate at P1–P5 remains for any active transaction. P6–P8 can finish
   by upload or text later.

The current `blocking` boolean becomes priority, and the existing question kinds (`ambiguous_match`,
`no_match`, `tentative_match`) are kept as P2 questions.

### E.4 Async interpretation: options and recommendation

| Option | Latency | Stale questions | Retries/dupes | Failures | Verdict |
|---|---|---|---|---|---|
| 1. Today: return the current analysis immediately; interpret later | Lowest | **Yes**: the newest statement is ignored | OK | Silent staleness | Reject |
| 2. Tool returns `pending`; agent calls a second `get_next_question` tool | +1 tool round-trip | No | Two keys to manage | The agent LLM may skip the second call | Reject: relies on the agent's LLM |
| 3. Scripted only, synchronous | Low | No | OK | No model | Too weak for narratives (live S3/S5 failures) |
| **4. Bounded synchronous turn (recommended)** | ≤ ~5 s, covered by `pre_tool_speech: "auto"` (tool timeout is 15 s, `cartesia.ts:59`) | No (or explicitly flagged) | Keyed per question | Explicit fallback question, labelled | **Recommend** |

**Option 4 in detail** (all inside the `httpAction`, which may call mutations and actions):

1. `recordVoiceUtterance` (mutation) resolves the session and reads the session's **last issued question**
   from `intakeTurns`. It does not trust a model-supplied ID. It computes the idempotency key
   `(callId, questionId, normalizedUtterance)`, redacts secrets, inserts the statement with
   `inResponseTo`, and creates an `interpretationAttempts` row (`attemptId`). A duplicate returns the
   **stored response** of the original turn (`processedEvents.resultRef` → `intakeTurns`), so a retry
   never advances the flow twice.
2. **Deterministic slot parse** (rule-based, labelled `system_derived/scripted`): if the asked question
   expects yes/no, a choice, an amount or a date, parse the answer against that slot. "Yes", "me",
   "24 dollars and 99 cents" resolve here in under 50 ms. This is a separate, labelled extractor for
   targeted answers, not a silent fallback for live interpretation.
3. If the turn is free narrative, or the parse fails, run live interpretation with a **4.5 s budget**.
4. Apply results only if `attemptId` is still the statement's current attempt (otherwise
   `discarded_stale`). Recompute claim state; `stateVersion++`.
5. `selectNextQuestion`, then log the issued question in `intakeTurns` with `stateVersion`.
6. **Timeout or failure:** the statement is kept and its attempt continues in the background (scheduled).
   The response sets `state_complete: false` and asks either the **highest-priority question whose
   target facts the pending statement cannot affect** (questions declare `dependsOnNarrative`), or a
   neutral "Thanks. Is there anything else about that you want to add?" It never asks something the
   customer may just have answered. When the background attempt lands, the next turn picks it up.
7. Concurrent tool calls in one call are serialized by Convex mutations (OCC). Statement numbering is
   already safe (`model.ts:122`).

Response shape:

```json
{ "recorded": "S7", "duplicate": false, "state_version": 12, "state_complete": true,
  "question_id": "Q-INIT-1", "question": "Did you personally enter and send the $1,200 payment, or did someone else do that?",
  "urgent_notice": null, "offer_upload": false, "handoff": false }
```

The agent instructions change to: "ask `question` and only that, in your own natural words; if
`urgent_notice` is set, say it first."

### E.5 Scenario walk-throughs

**Account takeover (R1).** Q-CONSENT → Q-OPEN: "I saw three Zelle payments I didn't make." → Q-URG-2 (not
yet reported) → urgent notice to call the bank → Q-TXN-1 (three, with read-back) → Q-INIT-1 ×3 ("someone
else") → Q-CODE-1 ("no, nobody asked me anything") → Q-NOT-1 → Q-REC-1 → Q-ACCT-1. Screen:
R1 `potential` for all three, rail confirmed `zelle`; blocking facts: none. Tasks: a provisional-credit
check about 10 business days after notice (estimate, `trigger_reported`).

**Code sharing, then the scammer sends (R1, the brief's example).** "Someone claiming to be my bank asked
for a code, and then money disappeared." Not classified. → Q-URG-1 → Q-CODE-2 "What did they tell you the
code would do?" ("verify my identity to stop fraud") → Q-TXN-1 → Q-INIT-1 ("I didn't send anything, it
just went") with read-back confirmation. `entered_by = other_person_own_device`,
`disclosed_types = [otp]`. Screen: R1 `potential` via R-E02 (FAQ Q5–Q6). Caveat recorded: "institution
may assert the code was 'furnished'; FAQ guidance says induced sharing is not furnishing (non-binding
compliance aid)."

**Customer-initiated scam (R2).** "I sent $2,000 on Zelle to someone from my bank's fraud team to protect
my money." → Q-URG-1 → Q-INIT-1 read-back ("Just to confirm, you entered and sent the $2,000 Zelle payment
yourself?" "Yes") → Q-BELIEF-1 → Q-IMP-1 (own bank) → Q-NOT-1. Screen: Reg E unauthorized route
`unlikely_under_current_text` (R-E03), Zelle imposter policy `potential` (non-public criteria, R-P01),
institution scam review `potential`. Legal screen: `insufficient_information` until the institution
responds. Intake is **not** told "you're not covered".

**Mixed (R3).** The scammer used a code to send $900 and $600, then talked the customer into "moving the
rest to a safe account" ($1,500, sent by the customer). Per-transaction rows: T1 and T2 R1 `potential`;
T3 R2 routes. The schedule shows both groups; the notice draft covers T1 and T2 as unauthorized and T3 as
a scam review request, with no blended label.

**Uncertain (R4).** "He was on my computer, I don't know who clicked send." → Q-RA-1 → "Did you see the
mouse move on its own?" ("I wasn't looking") → `entered_by = unknown`, `remote_access = yes_still_installed`
→ urgent notice (disconnect, remove the software, use another device to call the bank). Both screens:
`needs_facts`, plus a reviewer task: "request the institution's session and device records". What cannot
be inferred is stated explicitly (§F.3).

---

## F. Comparison matrix and legal rule registry

### F.1 Customer claim vs available evidence (actual payloads only)

Nessie fields available [Code `nessie.ts:22-46`]: purchase `_id, merchant_id, medium, purchase_date |
transaction_date, amount, status, description, type, payer_id`; account `type, nickname, customer_id,
balance`; merchant `name, category`. CRS returns only identity-verification `messages[{code,text}]` plus a
`RequestID` header [Code `crs.ts:27-33, 112`].

| Customer claim | Provider/document evidence | Normalization | Agreement rule | Cannot be inferred | Next step |
|---|---|---|---|---|---|
| Identity of claimant | CRS persona result (sandbox) | Message count, codes | Messages present → reviewer note only | Account ownership; anything about a real person (sandbox) | Reviewer identity task |
| Account relationship | Nessie account `customer_id`, `type` | — | Bound by the backend; demo only | That the caller is the account holder | Q-ACCT, document upload |
| Amount | `amount` (may be integer dollars) | Both in minor units | Exact → agree; < $1 with integer record → approximate (existing rule) | — | Read-back |
| Date | `purchase_date` (date only) | partialDate in the claimant's time zone | ≤1 day agree; ≤3 day plausible (existing) | Time of day; time zone of the record | Q-TXN-2 |
| Recipient/merchant | merchant `name` | `normalizeName` | Token match (existing) | The recipient's real identity | Q-RCPT-1 |
| Status | `status` string | As-is | — | **A posted or executed status does not show authorization** | — |
| Rail | none (`medium` is the funding medium) | — | **No rule**: never inferred | Rail | Q-RAIL-1, statement upload |
| Who initiated | **no access, device or session evidence** | — | — | Initiation; credential use | Reviewer: request institution logs |
| Reported to bank on date X | Correspondence docs (if uploaded) | partialDate | Document date wins; discrepancy noted neutrally | — | Q-NOT-1, upload |
| Money returned | Nessie deposits (**not retrieved yet**; shape [Confirm]); letters | Recovery events | Allocate per transaction; provisional ≠ final | Whether a deposit is a reversal unless labelled | Q-REC-1 |

Hard rules in code (tested): sandbox facts cannot support a production assessment; a provider failure sets
`evidence_unavailable` and never a negative route; customer-reported facts are never upgraded by repetition
(a later CRM-style note that repeats the customer has `source: customer_reported`); a missing document is
`unknown`, never a credibility signal.

### F.2 Rule metadata schema (`lib/domain/rules/registry.ts`, human-edited only)

```ts
{ id, title, source: { citation, url, type: "statute"|"regulation"|"official_interpretation"|"agency_guidance"
  |"network_rule"|"agreement"|"case_decision"|"enforcement" }, jurisdiction, coverage: { rails, accountPurpose, products },
  requiredFactKeys, exceptions: string[], uncertainty: "low"|"medium"|"high",
  deadline?: { kind: "statutory"|"institution_procedure"|"internal", length, unit: "business_days"|"calendar_days"|"years",
               triggerFactKey, calculationNote },
  effectiveDate?, verifiedOn, verifiedBy, verbatimVerified: boolean, humanReviewRequired: boolean }
```

### F.3 v1 rules (from the repo pack; verification status per row)

| Rule | Source and type | Coverage | Required facts | Exceptions / uncertainty | Deadline trigger (calculation basis) | Verified | Human review |
|---|---|---|---|---|---|---|---|
| R-RT01 Reg E coverage | 12 CFR 1005.2(b), 1005.3(b)-(c); 15 U.S.C. 1693a; regulation | Consumer asset accounts | account.purpose, product, txn.rail | Checks, Fedwire-type wires, securities, some phone transfers excluded; online consumer wires contested (People v. Citibank, on appeal) | — | 1005.3(c)(3) verbatim 2026-10-23 (repo); rest [Pack] | Business, wire, mixed |
| R-E01 Unauthorized EFT | 1005.2(m); regulation | Reg E rails | entered_by, prior_permission, benefit_received | Furnished device (2(m)-2); fraudulent intent; institution employee | via R-E09 | Verbatim 2026-10-23 (repo) | Family or caregiver; any benefit |
| R-E02 Device or credentials obtained by fraud | Comment 2(m)-3 (official interpretation); CFPB EFT FAQ Unauthorized EFTs Q5–Q6 (guidance) | Reg E rails | entered_by ≠ customer, disclosed_types | Customer pressed send → R-E03; acting in concert | via R-E09 | Comment 2026-10-23 (repo); **FAQ Q5–Q8 verified 2026-10-24** (page updated Jan 15, 2025; answers dated June 4, 2021) | Institution cites "shared code" |
| R-E03 Customer-initiated scam | 1005.2(m) text; Wilkins v. Navy Federal (D.N.J. 2023) | Reg E rails | entered_by = customer, customer_belief | If the scammer pressed send (including remote control) → R-E02 | none statutory | [Pack] | Large loss; remote access unclear |
| R-E06/E07 Liability tiers | 1005.6(b)(1)-(3); regulation | Unauthorized EFT | device_loss_learned_at, statement_date, notice.first_reported_at | Extension (b)(4); notice by reasonable steps (b)(5); lower state or contract liability | 2 business days from learning of loss or theft; 60 days from statement **transmittal** | **Text verified 2026-10-24** | Always (liability is the institution's call) |
| R-E08 Negligence and agreement | Comments 6(b)-2/-3; FAQ Q7–Q8 | Unauthorized EFT | — | — | — | **FAQ Q7–Q8 verified 2026-10-24** | Denial cites negligence |
| R-E09 Notice of error | 1005.11(b)(1) | Reg E | notice.*, statement_date | Late notice: 1005.6 limits still apply (comment 11(b)(1)-7) [Pack] | **60 calendar days after the institution sends the statement** first reflecting the error | **Text verified 2026-10-24** | Rejected as late |
| R-E10 Written confirmation | 1005.11(b)(2); FAQ Error Resolution Q4 | Reg E | written_confirmation_* | Institution may not delay investigation pending documents | 10 business days from oral notice (customer side) | FAQ Q4 **verified 2026-10-24**; (b)(2) [Pack] | Police report or affidavit required first |
| R-E11 Investigation and provisional credit | 1005.11(c)(1)-(3) | Reg E | notice date, opened_recently, rail (POS debit, out-of-state) | $50 withholding (unauthorized); 20 business days / 90 days in listed cases | 10 business days to determine, or 45 days with provisional credit within 10 business days; report within 3 business days | **Text verified 2026-10-24** | No provisional credit by the estimate |
| R-E12 Reasonable investigation | 1005.11(c)(4); BofA order 2022 | Reg E | determination reason | Fact-specific | — | [Pack] | Denial on login match or score alone |
| R-E13 No-error procedures | 1005.11(d)(1)-(2) | Reg E | determination, explanation_received | — | Notice of debit; 5 business days honoring period | **Text verified 2026-10-24** | Missing explanation |
| R-E15 Civil liability and time limit | 15 U.S.C. 1693m, 1693f(e), 1693g(b) | Reg E | dispute history | Bona fide error | 1 year from the violation (how courts fix the date was not researched) | [Pack] | **Always** for the legal screen |
| R-P01 Zelle imposter policy | Network policy (non-public) | Zelle | claimed_identity, rail | Not for purchase or romance scams (secondary reporting) | Not published | [Pack] | Denial without reason |
| R-Z01/Z03 Credit card | 1026.12(b), 1026.13 | Credit card | rail, notice in writing | Apparent authority under state law | 60 days from statement transmittal (written) | [Pack] | All in v1 |
| R-V01/V02 Recording and AI disclosure | 18 U.S.C. 2511(2)(d); all-party state statutes; FCC 24-17; Utah 13-75 | Intake | consent.recording, claimant.state | Caller location unknown, so treat all as all-party | Before recording | [Pack] (secondary compendium) | Consent declined |

**Specialist-only rules** (metadata kept in the CSV, no automated routing in v1): R-RT02, R-E04, R-E05,
R-E14, R-E16, R-Z02, R-Z04, R-Z05, R-W01–W05, R-K01, R-N01, R-N02, R-F01.

**Discrepancies found while checking:**

- `lib/domain/regulatory.ts:115` paraphrases the FAQ; the verified wording is now available (Q5: "the
  transfer is an unauthorized EFT under Regulation E"; Q6: "has not furnished an access device").
  **A human should update that file** (CLAUDE.md forbids automated edits).
- The FAQ has **no** question on remote access or screen sharing. Only Q5's "phishing or other methods to
  gain access to a consumer's computer" example comes close, so R4 stays human-reviewed.

**Unresolved research:** source register S01–S67 (tab A, missing); exact Visa and Mastercard time limits;
Zelle criteria; the Second Circuit outcome in People v. Citibank; state UCC enactment variations; how
"violation" is dated for the 1693m(g) one-year limit; Cartesia's audio and transcript retention.

### F.4 Deadlines: three separate kinds

- **Statutory:** a rule with `deadline.kind = statutory`. It is shown as an *estimate* with the working
  ("60 calendar days after 2026-09-30 statement (reported, not verified) ≈ 2026-11-29").
- **Institution procedure:** from the institution's own letters or agreement; recorded as reported.
- **Internal reminder:** for example, "ask whether provisional credit arrived" around business day 10.
  Business days use the US federal holiday calendar as a **labelled assumption**, because 1005.2(d) defines
  business days by the institution's own opening days [Pack].
- No universal fraud deadline exists, and none is shown.

---

## G. Incremental implementation plan

Every phase is additive (new tables and optional fields), runs on the **cloud dev deployment only**, keeps
`npm run verify` green, and updates `CONTEXT.md`. No production migrations or deploys. Live calls only
with your go-ahead.

| Phase | Changes | Files | Compatibility and risks |
|---|---|---|---|
| **0. Voice quick wins** (fixes live issues within the new design) | Question IDs; `intakeTurns`; idempotency key includes question ID; `inResponseTo` on statements; spoken amounts ("24 dollars and 99 cents", bare decimals in money context); remove the legal "authorized?" question; redact-on-ingest | `convex/schema.ts`, `convex/voice.ts`, `convex/http.ts`, `lib/domain/idempotency.ts`, `lib/domain/interpret.ts`, `lib/domain/workflow.ts`, new `lib/domain/redact.ts`, tests | The tool response gains fields (additive). The agent prompt needs the new instruction; re-register the tool (you run it) |
| **1. Access control** | `caseMembers`, `convex/access.ts`, `tenantId`/`environment` on cases; every public function checks; demo identity policy until an auth provider is chosen | `convex/*.ts`, `components/*` | Breaking for anonymous use; needs the auth decision (§I). Can stub a "demo reviewer" identity first |
| **2. Fact model** | Fact registry, `facts` table, answer states; interpreter output written as facts (dual write with the existing interpretation); backfill internal mutation for dev cases (sandbox) | new `lib/domain/facts/registry.ts`, `lib/domain/facts/state.ts`, `convex/facts.ts`; `convex/model.ts` | Old `analysis` keeps working; the UI is unchanged |
| **3. Transactions, incidents, question engine** | `incidents`, `disputedTransactions`, per-transaction initiation; `selectNextQuestion`; new webhook response | new `lib/domain/intake/questions.ts`, `select.ts`; `convex/voice.ts`, `convex/http.ts`; `lib/providers/cartesia.ts` (tool description) | Multi-transaction matching reuses `matchTransactions` per row |
| **4. Bounded synchronous interpretation** | `interpretationAttempts`; slot parser; httpAction orchestration; stale-attempt guard | `convex/http.ts`, `convex/reasoning.ts`, `convex/statements.ts`, new `lib/domain/intake/slotParse.ts` | Active once the Bitdeer env vars are set (decision 9). Scripted mode works throughout |
| **5. Rules and assessments** | Rule registry (from the CSV, human-reviewed); reimbursement and legal screens; replace `recommendation` in the UI | new `lib/domain/rules/registry.ts`, `lib/domain/assessments.ts`, `lib/domain/routing.ts`; `convex/assessments.ts`; dashboard | CLAUDE.md "no legal determinations / deadline calculations" needs updating (§I). Rule edits are human-only, like `regulatory.ts` |
| **6. Disputes, correspondence, recoveries, tasks** | Tables plus state transitions (reviewer mutations); Nessie deposits retrieval (read-only, probe first); loss calculator | `convex/disputes.ts`, `lib/domain/recovery.ts`, `lib/domain/deadlines.ts`, `lib/providers/nessie.ts` | Deposits payload **[Confirm]** by a read-only probe |
| **7. Documents and artifacts** | Convex file storage upload link; artifact generators (markdown first, then PDF); sandbox watermark | `convex/documents.ts`, `convex/artifacts.ts`, `lib/domain/artifacts/*` | Do not claim institution form compliance |

Biggest risks: scope drift from CLAUDE.md's current non-goals; per-minute voice cost of longer calls; the
agent LLM ignoring `question`; and legal content going stale. Mitigations: a single source of rule truth
with `verifiedOn` dates, plus a test that fails when any v1 rule is more than 90 days past `verifiedOn`.

---

## H. Test plan

Unit (Vitest, pure domain) unless marked **[cvx]** (convex-test on edge-runtime) or **[http]** (webhook
through `t.fetch`).

| Scenario | Assertions |
|---|---|
| Account takeover | Three transactions, `entered_by=other_person_own_device`; R1 `potential` each; no "approved" anywhere; urgent question first if not yet reported |
| Customer-initiated scam | R-E03 `unlikely_under_current_text`; R-P01 `potential` only when Zelle and an impostor of a bank, business or government; overall never "denied" |
| Code sharing, then scammer initiation | `disclosed_types=[otp]` plus other person sent → R-E02 `potential`; caveat present; the customer was never asked "was it authorized" (question log check) |
| Remote access | `entered_by=unknown` → both screens `needs_facts`; reviewer task "request session/device records"; urgent notice when still installed |
| Mixed transactions | Per-transaction routes differ; no amount-conflict across different transactions; schedule groups correct |
| Prior limited permission | `prior_permission=limited` → R-E01 exception surfaced; human review required |
| Missing or conflicting dates | Month-precision date never yields a day-precision deadline; conflicting dates for the same transaction → neutral clarification question; a document date supersedes a reported date with a discrepancy note |
| Provider failure | Nessie/CRS error → `evidence_unavailable`, assessment never negative, no fixture substitution (extends existing tests) |
| Duplicate voice events **[http]** | Same call, question and utterance → identical stored response, one statement; "Yes" to two different questions → two statements |
| Stale model results **[cvx]** | Attempt A superseded by retry B: A's late success is `discarded_stale`; a late failure of A doesn't flip B's `done` |
| Webhook budget **[http]** | Mock interpreter delays 6 s → response within budget, `state_complete:false`, question not dependent on the pending statement |
| Cross-case access **[cvx]** | User on case X cannot read or write case Y; `correctsRef`/`T:` refs from case Y are rejected; voice session for X cannot record into Y |
| Partial, provisional and final credits | Provisional $500 then final $500 replaces → recovered $500, not $1,000; partial final on one of two transactions allocates correctly; a provisional reversal reopens the outstanding amount |
| Redaction | Luhn-valid PAN and "the code was 482913" are stored redacted; the activity log never contains them |
| Sandbox labelling | Any sandbox-sourced fact sets `sandboxOnly` on the assessment and the artifact watermark |
| No repeats | A question issued twice without an answer is not issued a third time |
| Rule freshness | Fails when a v1 rule's `verifiedOn` is older than 90 days |

---

## I. Decisions (answered 2026-10-24)

| # | Question | Decision | Effect on this design |
|---|---|---|---|
| 1 | Who uses it, who submits | **Consumers file claims; the software is an extension of the bank** | A report made here is likely notice to the bank, which starts the 1005.11 clock. Store the report's exact timestamp as `notice.first_reported_at` (`document_supported` by our own record). The "submit to institution" step becomes a hand-off inside the bank, not a letter the customer mails |
| 2 | CLAUDE.md scope | **Yes:** several payments per case, labelled deadline estimates, both screens | `CLAUDE.md` updated. Phases 3, 5 and 6 are unblocked |
| 3 | Credit cards | **Full support in the first release** | B.1 R5 moves from "routing only" to full: Reg Z routing, written billing-error notice draft, reminders. The rules R-Z01–R-Z04 in F.3 become v1 rules; R-Z05 (network chargebacks) stays specialist |
| 4 | Login | **Demo login now (Convex Auth); bank SSO later** | Phase 1 uses Convex Auth behind `requireCaseAccess`, so the bank's identity provider can replace it |
| 5 | Call length | **Keep the 3-minute cap** | Intake must be resumable: a call covers P0–P3 (safety, narrative, payments, who sent them). The rest continues by text or a follow-up call. Questions keep priority order |
| 6 | Recording | **Transcribe only; consent first** | Consent step in the agent instructions (`docs/integrations.md`). Check Cartesia's retention settings for audio |
| 7 | AI disclosure | **Every call** | In the agent instructions |
| 8 | Reference pack | Unknown to the user | Folder stays **untracked** and is not committed. The rule CSV remains a research input; the missing tabs are not expected |
| 9 | Bitdeer | **Bitdeer does the extraction** (initially removed, then reinstated the same day) | Live interpretation through Bitdeer once the key and model are set. Phase 4 (bounded wait) becomes active. The model receives the question being answered. `npm run live:reasoning` checks key, model and latency |
| 10 | Nessie deposits | **Probe approved** | Done: endpoint returns 200 with `[]`. Payload shape still unverified (needs a seeded synthetic deposit, a write) |
| 11 | FAQ wording | **Approved; edited** | `regulatory.ts` quotes now matched word for word against the live page |
| 12 | Commit | **Commit on `foundation`; push after the live test** | — |
| 13 | Repeat limit | **2 per call** | Unchanged |
| 14 | Automatic reimbursement | **Approve-only; up to $100; SIMULATED Nessie deposit** | Policy AUTO-1 (`lib/domain/autoApproval.ts`) replaces "never approves" for qualifying claims. Every check must pass; a claim that fails any check goes to a person. Denials are never automated (12 CFR 1005.11(c)-(d) investigation and written explanation; CFPB 2022 action on denials by automated filter). Facts that change after approval flag it for review; nothing is reversed automatically |
| 15 | Verify, don't trust (AUTO-1 v2) | **All four protections** | Automatic approval also needs: a payment-origin record not pointing to the customer (SYNTHETIC, case-page preset), no earlier payments to the same merchant, no refund-like deposit, a CRS identity check that ran clean, and a CRS Fraud Finder score of 30 or less. Signals only stop automatic approval and are shown to the reviewer; they never deny. Credit and criminal data are excluded |
