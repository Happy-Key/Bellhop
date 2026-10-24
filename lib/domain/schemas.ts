/**
 * Domain schemas shared by the browser, Convex functions, and tests.
 * Browser-safe: no secrets, no Node-only imports.
 *
 * Evidence categories are deliberately kept distinct:
 *  - customer_statement     what the customer said (never treated as established fact)
 *  - transaction_record     facts established by bank (Nessie) records
 *  - external_provider      facts returned by an external evidence provider (e.g. CRS)
 *  - rule_based_inference   conclusions from deterministic application rules (e.g. matcher)
 *  - model_inference        conclusions proposed by a reasoning model
 * Unresolved questions are a separate list, never a finding.
 */
import { z } from "zod";

export const SOURCE_CATEGORIES = [
  "customer_statement",
  "transaction_record",
  "external_provider",
  "rule_based_inference",
  "model_inference",
] as const;
export const SourceCategory = z.enum(SOURCE_CATEGORIES);
export type SourceCategory = z.infer<typeof SourceCategory>;

/** Stable evidence identifiers. Prefix encodes the evidence kind. */
export const STATEMENT_REF = /^S\d+$/; // S1, S2 … per case
export const TRANSACTION_REF = /^T:[A-Za-z0-9_-]+$/; // T:<nessie purchase id>
export const PROVIDER_REF = /^X:[A-Za-z0-9_.:-]+$/; // X:crs:<id>
export const REGULATORY_REF = /^R:[a-z0-9_.-]+$/; // R:<curated source id>

export type EvidenceKind = "statement" | "transaction" | "provider" | "regulatory";
export function evidenceKindOf(ref: string): EvidenceKind | null {
  if (STATEMENT_REF.test(ref)) return "statement";
  if (TRANSACTION_REF.test(ref)) return "transaction";
  if (PROVIDER_REF.test(ref)) return "provider";
  if (REGULATORY_REF.test(ref)) return "regulatory";
  return null;
}

export const Channel = z.enum(["text", "voice"]);
export type Channel = z.infer<typeof Channel>;

export const AuthorizationClaim = z.enum([
  "denies_authorization", // "I didn't make this payment"
  "authorized_induced", // customer made the payment but was deceived (scam)
  "authorized", // customer made it, no deception claimed
  "unspecified",
]);
export type AuthorizationClaim = z.infer<typeof AuthorizationClaim>;

export const CredentialSharing = z.enum(["shared", "not_shared", "unspecified"]);
export type CredentialSharing = z.infer<typeof CredentialSharing>;

export const InterpretationMode = z.enum(["scripted", "live"]);
export type InterpretationMode = z.infer<typeof InterpretationMode>;

/** Structured reading of ONE customer statement. Customer-reported, not fact. */
export const StatementInterpretation = z.object({
  mode: InterpretationMode,
  provider: z.string().min(1),
  amounts: z.array(z.number().positive().finite()).max(10),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(10),
  merchantTerms: z.array(z.string().min(1).max(80)).max(10),
  authorization: AuthorizationClaim,
  credentialSharing: CredentialSharing,
  scamIndicators: z.array(z.string().max(80)).max(10),
});
export type StatementInterpretation = z.infer<typeof StatementInterpretation>;

/** The question a statement answers, as it was put to the customer. */
export const AskedQuestion = z.object({ key: z.string().min(1).max(200), kind: z.string().min(1).max(40), text: z.string().max(600) });
export type AskedQuestion = z.infer<typeof AskedQuestion>;

/**
 * How a statement answered the question it replied to. `unknown` and `declined` are answers:
 * the question is not asked again. `unparsed` means the reply did not settle it.
 */
export const AnswerState = z.enum(["answered", "unknown", "declined", "unparsed"]);
export type AnswerState = z.infer<typeof AnswerState>;

export const StatementAnswer = z.object({
  key: z.string(),
  kind: z.string(),
  state: AnswerState,
  /** Values read from a short reply using the question as context (rule-based, labelled by parser). */
  derived: z
    .object({
      authorization: AuthorizationClaim.optional(),
      credentialSharing: CredentialSharing.optional(),
      confirmsTxnRef: z.string().optional(),
      rejectsTxnRef: z.string().optional(),
    })
    .optional(),
  parser: z.string(),
});
export type StatementAnswer = z.infer<typeof StatementAnswer>;

export const Statement = z.object({
  ref: z.string().regex(STATEMENT_REF),
  text: z.string().min(1).max(4000),
  channel: Channel,
  receivedAt: z.number(),
  /** Original statements are never edited; a correction points at the statement it corrects. */
  correctsRef: z.string().regex(STATEMENT_REF).optional(),
  interpretation: StatementInterpretation.nullable(),
  inResponseTo: AskedQuestion.optional(),
  answer: StatementAnswer.optional(),
});
export type Statement = z.infer<typeof Statement>;

/** Normalized bank transaction evidence (from Nessie). */
export const TransactionEvidence = z.object({
  ref: z.string().regex(TRANSACTION_REF),
  provider: z.literal("nessie"),
  externalId: z.string(),
  kind: z.enum(["purchase", "withdrawal", "transfer", "deposit"]),
  amount: z.number().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().nullable(),
  merchantId: z.string().nullable(),
  merchantName: z.string().nullable(),
  status: z.string().nullable(),
  medium: z.string().nullable(),
});
export type TransactionEvidence = z.infer<typeof TransactionEvidence>;

/** A fact returned by an external evidence provider (e.g. CRS). */
export const ProviderEvidence = z.object({
  ref: z.string().regex(PROVIDER_REF),
  provider: z.string(),
  product: z.string(),
  field: z.string(),
  value: z.string(),
  /** True when the subject association is synthetic (e.g. CRS test identity linked for demo). */
  syntheticAssociation: z.boolean(),
});
export type ProviderEvidence = z.infer<typeof ProviderEvidence>;

export const FindingStatus = z.enum(["established", "supported", "tentative", "disputed", "unverified"]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Machine-checkable assertion a finding makes about a referenced record. */
export const FindingAssertion = z.object({
  ref: z.string(),
  field: z.enum(["amount", "date", "merchant"]),
  value: z.union([z.string(), z.number()]),
});
export type FindingAssertion = z.infer<typeof FindingAssertion>;

export const Finding = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(600),
  category: SourceCategory,
  evidenceRefs: z.array(z.string()).min(1).max(20),
  status: FindingStatus,
  contradictions: z.array(z.string().max(300)).max(10),
  assertions: z.array(FindingAssertion).max(10).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const QuestionKind = z.enum([
  "narrative",
  "missing_transaction_details",
  "ambiguous_match",
  "no_match",
  "tentative_match",
  "conflict",
  /** Who entered and sent the payment. Asks about actions, never "was it authorized". */
  "initiation",
  "credential_sharing",
  "code_purpose",
  "payment_purpose",
  "evidence_unavailable",
  "multiple_amounts",
  "identity_review",
]);
export type QuestionKind = z.infer<typeof QuestionKind>;

/** Who a question is for. Reviewer questions are never read to the customer. */
export const QuestionAudience = z.enum(["customer", "reviewer"]);
export type QuestionAudience = z.infer<typeof QuestionAudience>;

export const OpenQuestion = z.object({
  /** Display ID (Q1, Q2 …), renumbered on every analysis. */
  id: z.string(),
  /** Stable identity across analyses (e.g. "initiation", "conflict:amount"); used to log and de-duplicate asks. */
  key: z.string(),
  kind: QuestionKind,
  text: z.string(),
  relatedRefs: z.array(z.string()),
  blocking: z.boolean(),
  audience: QuestionAudience,
  /** Lower is asked first. */
  priority: z.number(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/** The investigator may only RECOMMEND. Nothing here approves money movement. */
export const RecommendedAction = z.enum([
  "request_clarification",
  "further_investigation",
  "escalate",
  "reimbursement_review",
]);
export type RecommendedAction = z.infer<typeof RecommendedAction>;

export const WORKFLOW_STAGES = [
  "intake",
  "retrieve_evidence",
  "match_transactions",
  "clarify_facts",
  "assess_considerations",
  "prepare_packet",
  "human_review",
] as const;
export const WorkflowStage = z.enum(WORKFLOW_STAGES);
export type WorkflowStage = z.infer<typeof WorkflowStage>;
