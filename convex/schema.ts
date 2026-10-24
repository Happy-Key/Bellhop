import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { askedQuestion, bankFetch, channel, interpretation, statementAnswer, transactionFields } from "./validators";

export default defineSchema({
  /** One investigation. All customer data is synthetic in this prototype. */
  cases: defineTable({
    title: v.string(),
    synthetic: v.literal(true),
    customerLabel: v.string(),
    /** Bound by the backend at creation. Never taken from client or model input. */
    nessieAccountId: v.union(v.string(), v.null()),
    /** CRS test persona linked by a reviewer. SYNTHETIC association: CRS and Nessie are separate datasets. */
    crsPersonaId: v.optional(v.string()),
    /** SYNTHETIC demo persona (lib/fixtures/demoPersonas.ts) the case was opened for on /call; its records are set up automatically. */
    demoPersonaId: v.optional(v.string()),
    nextStatementNumber: v.number(),
    bankFetch,
    /** Derived CaseAnalysis (lib/domain/workflow.ts), recomputed after every evidence change. */
    analysis: v.any(),
    analysisVersion: v.number(),
    /** Current automatic-approval evaluation (lib/domain/autoApproval.ts), recomputed with the analysis. */
    autoApproval: v.optional(v.any()),
    createdAt: v.number(),
  }),

  /** Customer statements. Never edited after insert; corrections are new rows with correctsRef. */
  statements: defineTable({
    caseId: v.id("cases"),
    ref: v.string(),
    text: v.string(),
    channel,
    receivedAt: v.number(),
    correctsRef: v.optional(v.string()),
    /** The question this statement replied to (voice: the last question the backend issued on the call). */
    inResponseTo: v.optional(askedQuestion),
    /** Rule-based reading of a short reply against that question. */
    answer: v.optional(statementAnswer),
    /** Kinds of sensitive values removed from `text` before it was stored (values are never kept). */
    redactions: v.optional(v.array(v.string())),
    interpretation: v.union(interpretation, v.null()),
    interpretationStatus: v.union(v.literal("done"), v.literal("pending"), v.literal("failed")),
    interpretationError: v.optional(v.string()),
    /** Live interpretation attempt whose result may be applied. Results from any other attempt are discarded. */
    currentAttemptId: v.optional(v.string()),
    /** Model-proposed findings (unvalidated); validated in analysis. */
    proposedFindings: v.optional(v.array(v.any())),
    followUpQuestion: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_case", ["caseId"])
    .index("by_case_ref", ["caseId", "ref"]),

  /**
   * Bank transaction evidence retrieved live from Nessie. Append-only: when a re-retrieval returns
   * different values, the old row gets `supersededAt` and a new row is inserted with the same ref.
   */
  transactions: defineTable({ caseId: v.id("cases"), retrievedAt: v.number(), supersededAt: v.optional(v.number()), ...transactionFields })
    .index("by_case", ["caseId"])
    .index("by_case_ref", ["caseId", "ref"]),

  /** Facts returned by external evidence providers (CRS). Superseded rows are kept for history. */
  providerEvidence: defineTable({
    caseId: v.id("cases"),
    ref: v.string(),
    provider: v.string(),
    product: v.string(),
    field: v.string(),
    value: v.string(),
    syntheticAssociation: v.boolean(),
    retrievedAt: v.number(),
    supersededAt: v.optional(v.number()),
    supersededReason: v.optional(v.string()),
  }).index("by_case", ["caseId"]),

  activity: defineTable({
    caseId: v.id("cases"),
    at: v.number(),
    actor: v.string(),
    kind: v.string(),
    message: v.string(),
  }).index("by_case", ["caseId"]),

  /** Idempotency keys for client submissions and retried voice/webhook events. */
  processedEvents: defineTable({
    key: v.string(),
    caseId: v.id("cases"),
    at: v.number(),
    resultRef: v.optional(v.string()),
    /** JSON of the response first returned for this event; a retry gets exactly the same response. */
    response: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_case", ["caseId"]),

  /**
   * How a Nessie transaction was made (device, two-factor, location): the bank's authentication
   * records. SYNTHETIC in this prototype (Nessie has none); attached from a preset for the demo.
   */
  paymentOrigins: defineTable({
    txnExternalId: v.string(),
    channel: v.union(v.literal("card_present_chip_pin"), v.literal("card_not_present_online"), v.literal("mobile_banking_app"), v.literal("online_banking")),
    device: v.union(v.literal("customer_enrolled_device"), v.literal("new_device"), v.literal("not_applicable")),
    twoFactor: v.union(v.literal("passed"), v.literal("not_used"), v.literal("failed")),
    city: v.string(),
    state: v.string(),
    synthetic: v.literal(true),
    preset: v.string(),
    setAt: v.number(),
  }).index("by_txn", ["txnExternalId"]),

  /**
   * Automatic APPROVALS only (policy AUTO-1). Never a denial: claims that fail the policy have no
   * row and go to a person. The payout is a SIMULATED Nessie deposit, made at most once.
   */
  reimbursementDecisions: defineTable({
    caseId: v.id("cases"),
    txnRef: v.string(),
    amount: v.number(),
    policy: v.string(),
    /** auto_approved: policy AUTO-1. approved_by_person: a reviewer accepted a model-proposed approval. */
    outcome: v.union(v.literal("auto_approved"), v.literal("approved_by_person")),
    checks: v.array(v.object({ id: v.string(), passed: v.boolean(), detail: v.string() })),
    decidedAt: v.number(),
    payout: v.object({
      simulated: v.literal(true),
      status: v.union(v.literal("pending"), v.literal("deposited"), v.literal("failed")),
      depositId: v.optional(v.string()),
      reused: v.optional(v.boolean()),
      error: v.optional(v.string()),
      at: v.optional(v.number()),
    }),
    /**
     * Set when facts change after approval so the policy no longer passes: a person must look.
     * `failedChecks` names the policy checks that failed (labelled in the UI). `review` records the
     * person's look: affirmed clears the flag; otherwise the flag stays with their note.
     */
    needsReview: v.optional(
      v.object({
        at: v.number(),
        reason: v.string(),
        failedChecks: v.optional(v.array(v.string())),
        review: v.optional(v.object({ at: v.number(), affirmed: v.boolean(), note: v.string() })),
      }),
    ),
  }).index("by_case", ["caseId"]),

  /**
   * The reasoning model's assessments of a case: its investigation and proposed next step or
   * disposition (lib/domain/caseDecision.ts, lib/domain/investigation.ts). One row per case state
   * sent to the model (`signature`); only the newest row for a case is acted on, and earlier rows
   * are kept as the audit history.
   */
  caseProposals: defineTable({
    caseId: v.id("cases"),
    signature: v.string(),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("rejected_by_validation"), v.literal("failed")),
    /** "manual" when a reviewer asked for it; "auto" when the case state changed. */
    trigger: v.union(v.literal("auto"), v.literal("manual")),
    provider: v.optional(v.string()),
    /** Exactly what was sent to the model (CaseReasoningInput), kept for audit. */
    input: v.any(),
    requestedAt: v.number(),
    completedAt: v.optional(v.number()),
    /** Validated CaseProposal (stored as data; shown, never executed as instructions). */
    proposal: v.optional(v.any()),
    /** Validation problems: fatal ones for rejected_by_validation, dropped details otherwise. */
    problems: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    plan: v.optional(v.object({ kind: v.string(), note: v.string() })),
    /** What changed since the previous accepted assessment, computed by code (lib/domain/investigation.ts). */
    changeLog: v.optional(v.array(v.object({ kind: v.string(), text: v.string() }))),
    /** A person's answer to a proposal that needs one. */
    resolution: v.optional(v.object({ accepted: v.boolean(), note: v.string(), at: v.number(), decisionId: v.optional(v.id("reimbursementDecisions")) })),
  }).index("by_case", ["caseId"]),

  /**
   * What a person did on a case beyond answering a proposal (convex/proposals.ts `resolve`): an
   * override of the proposed handling with its reason, a return to the investigator with the work
   * requested, or a note. Append-only audit record. Overrides never move money.
   */
  reviewActions: defineTable({
    caseId: v.id("cases"),
    proposalId: v.optional(v.id("caseProposals")),
    kind: v.union(v.literal("override"), v.literal("return"), v.literal("note")),
    decision: v.optional(v.union(v.literal("deny"), v.literal("escalate"), v.literal("request_information"))),
    reason: v.string(),
    /** For "ask the customer" overrides: the question the reviewer wants asked on the call-back. */
    question: v.optional(v.string()),
    at: v.number(),
  }).index("by_case", ["caseId"]),

  /** Every question the backend put to the customer on a voice call, so it can avoid repeats. */
  intakeTurns: defineTable({
    caseId: v.id("cases"),
    sessionId: v.id("voiceSessions"),
    questionKey: v.string(),
    kind: v.string(),
    text: v.string(),
    issuedAt: v.number(),
    analysisVersion: v.number(),
    /** Statement that replied to it, once one arrives. */
    answeredByRef: v.optional(v.string()),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_key", ["sessionId", "questionKey"])
    .index("by_case", ["caseId"]),

  /**
   * Provider session state (server-only; never returned by a public function).
   * For CRS: the reusable bearer token, plus a login lock set on any failed login so we
   * never retry automatically (repeated failures disable the sandbox account).
   */
  providerAuth: defineTable({
    provider: v.string(),
    token: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    loginLockedAt: v.optional(v.number()),
    loginLockReason: v.optional(v.string()),
  }).index("by_provider", ["provider"]),

  /**
   * Questions a bank reviewer put to the customer. Asked first on the customer's next call or text
   * chat; answered when a customer reply to it is recorded (the statement ref is kept).
   */
  reviewerQuestions: defineTable({
    caseId: v.id("cases"),
    text: v.string(),
    askedAt: v.number(),
    answeredByRef: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    withdrawnAt: v.optional(v.number()),
  }).index("by_case", ["caseId"]),

  /** Short-lived voice session tokens binding a voice call to exactly one case. */
  voiceSessions: defineTable({
    token: v.string(),
    caseId: v.id("cases"),
    createdAt: v.number(),
    expiresAt: v.number(),
    /** Cartesia call ID (`session_ready.call_id`), bound once by the browser when the call starts. */
    callId: v.optional(v.string()),
    /** Question keys asked the maximum number of times on this call and handed to a reviewer. */
    handedOffKeys: v.optional(v.array(v.string())),
    /** No longer written (the "anything else?" acknowledgement was removed 2026-10-24); kept so older rows still validate. */
    lastResponseWasAck: v.optional(v.boolean()),
    /** "text" for the customer text chat (same turn logic as a call); absent or "voice" for calls. */
    channel: v.optional(v.union(v.literal("voice"), v.literal("text"))),
    /** When the backend gave the agent the closing message (end_call: true); the customer page then hangs up. */
    closingAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_call", ["callId"])
    .index("by_case", ["caseId"]),
});
