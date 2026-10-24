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
    nextStatementNumber: v.number(),
    bankFetch,
    /** Derived CaseAnalysis (lib/domain/workflow.ts), recomputed after every evidence change. */
    analysis: v.any(),
    analysisVersion: v.number(),
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
  }).index("by_key", ["key"]),

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
    .index("by_session_key", ["sessionId", "questionKey"]),

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
    /** The previous tool response was an acknowledgement; the next one must ask a question. */
    lastResponseWasAck: v.optional(v.boolean()),
  })
    .index("by_token", ["token"])
    .index("by_call", ["callId"]),
});
