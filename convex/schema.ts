import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { bankFetch, channel, interpretation, transactionFields } from "./validators";

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
    interpretation: v.union(interpretation, v.null()),
    interpretationStatus: v.union(v.literal("done"), v.literal("pending"), v.literal("failed")),
    interpretationError: v.optional(v.string()),
    /** Model-proposed findings (unvalidated); validated in analysis. */
    proposedFindings: v.optional(v.array(v.any())),
    followUpQuestion: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_case", ["caseId"])
    .index("by_case_ref", ["caseId", "ref"]),

  /** Bank transaction evidence retrieved live from Nessie. */
  transactions: defineTable({ caseId: v.id("cases"), retrievedAt: v.number(), ...transactionFields })
    .index("by_case", ["caseId"])
    .index("by_case_ref", ["caseId", "ref"]),

  /** Facts returned by external evidence providers (CRS — not yet implemented). */
  providerEvidence: defineTable({
    caseId: v.id("cases"),
    ref: v.string(),
    provider: v.string(),
    product: v.string(),
    field: v.string(),
    value: v.string(),
    syntheticAssociation: v.boolean(),
    retrievedAt: v.number(),
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
  }).index("by_key", ["key"]),

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
  }).index("by_token", ["token"]),
});
