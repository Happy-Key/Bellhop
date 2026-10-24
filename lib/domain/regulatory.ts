/**
 * Curated regulatory sources and scenario-scoped considerations.
 *
 * Scope: U.S. consumer deposit (asset) account claims, one disputed transaction, three
 * scenarios: (a) customer denies authorizing an electronic debit, (b) customer made the
 * payment after being deceived (scam), (c) customer mentions a wire transfer.
 *
 * Rules for this module:
 *  - Only sources listed here may be cited (R:<id>); nothing is fabricated.
 *  - Considerations are "potentially relevant", with explicit unresolved conditions.
 *  - No legal deadlines are calculated. Timing rules are named, not computed.
 *  - Regulation E is NOT presumed to apply, and scam payments are NOT presumed reimbursable.
 * See docs/regulatory-sources.md for review notes.
 */
import type { ClaimFacts } from "./facts";
import type { MatchResult } from "./matching";
import type { TransactionEvidence } from "./schemas";

export type SourceKind = "regulation" | "official_interpretation" | "agency_guidance" | "institution_policy";

export interface RegulatorySource {
  ref: string;
  kind: SourceKind;
  title: string;
  citation: string;
  url: string;
  reviewedOn: string;
  /** Short excerpt. `verbatimVerified: false` means it must be re-checked against the URL before external use. */
  excerpt: string;
  verbatimVerified: boolean;
  applicability: string;
}

export const REGULATORY_SOURCES: RegulatorySource[] = [
  {
    ref: "R:reg-e.1005.2m",
    kind: "regulation",
    title: "Regulation E — definition of unauthorized electronic fund transfer",
    citation: "12 CFR 1005.2(m)",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/2/",
    reviewedOn: "2026-10-23",
    excerpt:
      "an electronic fund transfer from a consumer's account initiated by a person other than the consumer without actual authority to initiate the transfer and from which the consumer receives no benefit.",
    verbatimVerified: true,
    applicability:
      "Only electronic fund transfers to/from a consumer account. Excludes transfers by a person furnished the access device by the consumer (absent notice), transfers with fraudulent intent by the consumer or anyone acting in concert, and transfers by the institution or its employee.",
  },
  {
    ref: "R:reg-e.interp.2m-2",
    kind: "official_interpretation",
    title: "Official interpretation 2(m)-2 — consumer furnished access device and authority exceeded",
    citation: "12 CFR part 1005, Supp. I, comment 2(m)-2",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-2/#2-m-Interp",
    reviewedOn: "2026-10-23",
    excerpt:
      "If a consumer furnishes an access device and grants authority to make transfers to a person who exceeds the authority given, the consumer is fully liable for the transfers unless the consumer has notified the financial institution…",
    verbatimVerified: true,
    applicability: "Relevant when the customer voluntarily gave a person their card/credentials and authority to transact.",
  },
  {
    ref: "R:reg-e.interp.2m-3",
    kind: "official_interpretation",
    title: "Official interpretation 2(m)-3 — access device obtained through fraud or robbery",
    citation: "12 CFR part 1005, Supp. I, comment 2(m)-3",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/interp-2/#2-m-Interp",
    reviewedOn: "2026-10-23",
    excerpt: "An unauthorized EFT includes a transfer initiated by a person who obtained the access device from the consumer through fraud or robbery.",
    verbatimVerified: true,
    applicability: "Relevant when a third party obtained the customer's access device or credentials by deception, then initiated the transfer.",
  },
  {
    ref: "R:reg-e.1005.3c3",
    kind: "regulation",
    title: "Regulation E coverage exclusion — wire transfers",
    citation: "12 CFR 1005.3(c)(3)",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/3/",
    reviewedOn: "2026-10-23",
    excerpt:
      "Any transfer of funds through Fedwire or through a similar wire transfer system that is used primarily for transfers between financial institutions or between businesses.",
    verbatimVerified: true,
    applicability: "Excludes qualifying wire transfers from Regulation E's definition of electronic fund transfer. Wires may instead be governed by other law (e.g. UCC Article 4A as enacted by the state) — not curated here.",
  },
  {
    ref: "R:reg-e.1005.6b",
    kind: "regulation",
    title: "Regulation E — consumer liability for unauthorized transfers",
    citation: "12 CFR 1005.6(b)",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/6/",
    reviewedOn: "2026-10-23",
    excerpt:
      "Liability tiers depend on when the consumer notifies the institution (e.g. within two business days after learning of loss or theft of an access device; within 60 days of the institution's transmittal of the statement).",
    verbatimVerified: false,
    applicability: "Applies only once a transfer is determined to be an unauthorized EFT. Requires notice dates and access-device facts — not computed by this prototype.",
  },
  {
    ref: "R:reg-e.1005.11",
    kind: "regulation",
    title: "Regulation E — procedures for resolving errors",
    citation: "12 CFR 1005.11",
    url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/11/",
    reviewedOn: "2026-10-23",
    excerpt:
      "The term error includes an unauthorized electronic fund transfer. Sets notice, investigation, provisional-credit and written-explanation requirements with specific time periods.",
    verbatimVerified: false,
    applicability: "Applies to errors on accounts covered by Regulation E. Time periods depend on notice date, account age, and transaction type — not computed by this prototype.",
  },
  {
    ref: "R:cfpb.eft-faq.induced-sharing",
    kind: "agency_guidance",
    title: "CFPB Electronic Fund Transfers FAQs — fraudulently induced sharing of account access information",
    citation: "CFPB EFT FAQs, Error Resolution: Unauthorized EFTs",
    url: "https://www.consumerfinance.gov/compliance/compliance-resources/deposit-accounts-resources/electronic-fund-transfers/electronic-fund-transfers-faqs/",
    reviewedOn: "2026-10-23",
    excerpt:
      "Guidance indicates a transfer can be unauthorized when a consumer is fraudulently induced into sharing account access information with a third party who then initiates the transfer, and that such a consumer has not 'furnished' an access device.",
    verbatimVerified: false,
    applicability: "Agency guidance (not the regulation itself). Relevant when a third party, not the consumer, initiated the transfer using credentials obtained by deception.",
  },
  {
    ref: "R:policy.demo-scam-review",
    kind: "institution_policy",
    title: "SYNTHETIC demo institution policy — authorized-payment scam review",
    citation: "Demo policy DP-1 (synthetic, for this prototype only)",
    url: "docs/regulatory-sources.md#synthetic-demo-policy",
    reviewedOn: "2026-10-23",
    excerpt:
      "Payments the customer initiated after being deceived are routed to a fraud specialist for review. Reimbursement is discretionary and is never automatic.",
    verbatimVerified: true,
    applicability: "Synthetic policy used to demonstrate the institution-policy category. Not a real institution's policy.",
  },
];

export const REGULATORY_REFS = new Set(REGULATORY_SOURCES.map((s) => s.ref));
export function getSource(ref: string): RegulatorySource | undefined {
  return REGULATORY_SOURCES.find((s) => s.ref === ref);
}

export type ConditionStatus = "supported_by_customer_statement" | "supported_by_record" | "contradicted" | "unresolved";

export interface ApplicabilityCondition {
  text: string;
  status: ConditionStatus;
  refs: string[];
}

export interface Consideration {
  sourceRef: string;
  relevance: string;
  conditions: ApplicabilityCondition[];
  reviewSteps: string[];
}

export interface ConsiderationInput {
  facts: ClaimFacts;
  match: MatchResult;
  matchedTxn: TransactionEvidence | null;
  mentionsWire: { mentioned: boolean; refs: string[] };
}

export function assessConsiderations({ facts, match, matchedTxn, mentionsWire }: ConsiderationInput): Consideration[] {
  const out: Consideration[] = [];
  const auth = facts.authorization;
  const cred = facts.credentialSharing;
  const txnRefs = matchedTxn ? [matchedTxn.ref] : [];

  const eftCondition: ApplicabilityCondition = {
    text: "The disputed transaction is an electronic fund transfer from a consumer asset account (not a credit card, check, or excluded wire).",
    status: "unresolved",
    refs: txnRefs,
  };
  const transactionIdentified: ApplicabilityCondition = {
    text: "The disputed transaction has been identified in account records.",
    status: match.outcome === "clear" ? "supported_by_record" : "unresolved",
    refs: txnRefs,
  };

  if (mentionsWire.mentioned) {
    out.push({
      sourceRef: "R:reg-e.1005.3c3",
      relevance: "Customer mentioned a wire. If the payment moved through Fedwire or a similar system, it may be excluded from Regulation E coverage.",
      conditions: [{ text: "Payment rail (wire vs. card/ACH/P2P) confirmed from records.", status: "unresolved", refs: mentionsWire.refs }],
      reviewSteps: ["Confirm the payment rail from core banking records.", "If a wire, route to wire-dispute review under applicable state law."],
    });
  }

  if (!auth) return out;

  if (auth.value === "denies_authorization") {
    const credCondition: ApplicabilityCondition =
      cred?.value === "not_shared"
        ? { text: "Customer did not furnish their access device or credentials to the person who initiated the transfer.", status: "supported_by_customer_statement", refs: [cred.statementRef] }
        : { text: "Whether the customer furnished their access device or credentials to the person who initiated the transfer.", status: "unresolved", refs: cred ? [cred.statementRef] : [] };
    out.push({
      sourceRef: "R:reg-e.1005.2m",
      relevance: "Customer reports they did not authorize the transaction. The unauthorized-EFT definition may be relevant if its conditions are met.",
      conditions: [
        transactionIdentified,
        eftCondition,
        { text: "Transfer was initiated by a person other than the customer.", status: "supported_by_customer_statement", refs: [auth.statementRef] },
        credCondition,
        { text: "Customer received no benefit from the transfer.", status: "unresolved", refs: [] },
        { text: "No indication the customer or someone acting in concert had fraudulent intent (not assumed either way).", status: "unresolved", refs: [] },
      ],
      reviewSteps: [
        "Confirm transaction type and payment rail from records.",
        "Confirm access-device / credential circumstances with the customer.",
        "Record the date the customer first gave notice (needed before any timing rule is assessed).",
      ],
    });
    if (cred?.value === "shared") {
      out.push({
        sourceRef: "R:cfpb.eft-faq.induced-sharing",
        relevance: "Customer reports sharing credentials. Guidance distinguishes fraudulently induced sharing from voluntarily furnishing an access device.",
        conditions: [
          { text: "Credentials were obtained by deception (not voluntarily given with authority to transact).", status: "unresolved", refs: [cred.statementRef] },
          { text: "A third party, not the customer, initiated the transfer.", status: "supported_by_customer_statement", refs: [auth.statementRef] },
        ],
        reviewSteps: ["Document how the credentials were requested and by whom.", "Compare with comment 2(m)-2 (authority exceeded) vs 2(m)-3 (obtained through fraud)."],
      });
      out.push({
        sourceRef: "R:reg-e.interp.2m-3",
        relevance: "If a third party obtained the access device through fraud, the official interpretation treats resulting transfers as unauthorized.",
        conditions: [{ text: "Access device/credentials obtained through fraud or robbery.", status: "unresolved", refs: [cred.statementRef] }],
        reviewSteps: ["Obtain the customer's account of how the credentials were obtained."],
      });
    }
    out.push({
      sourceRef: "R:reg-e.1005.11",
      relevance: "If Regulation E covers the transfer, error-resolution procedures and time periods apply. Not computed here.",
      conditions: [eftCondition, { text: "Date the institution received the customer's notice.", status: "unresolved", refs: [] }],
      reviewSteps: ["Human reviewer determines coverage and applicable time periods."],
    });
  } else if (auth.value === "authorized_induced") {
    out.push({
      sourceRef: "R:reg-e.1005.2m",
      relevance:
        "Customer reports making the payment themselves after being deceived. The unauthorized-EFT definition requires initiation by a person other than the consumer, so it may not apply. This is not a determination.",
      conditions: [
        transactionIdentified,
        { text: "Transfer was initiated by a person other than the customer.", status: "contradicted", refs: [auth.statementRef] },
      ],
      reviewSteps: ["Confirm who initiated the payment (customer vs. third party with credentials).", "Route to scam review under institution policy."],
    });
    out.push({
      sourceRef: "R:policy.demo-scam-review",
      relevance: "Customer-initiated scam payments go to specialist review; not automatically reimbursable.",
      conditions: [{ text: "Customer reports deception by a third party.", status: facts.scamIndicators.length ? "supported_by_customer_statement" : "unresolved", refs: facts.scamIndicators.map((s) => s.statementRef) }],
      reviewSteps: ["Escalate to fraud specialist.", "Collect scam details (contact channel, instructions given, recipient)."],
    });
  }
  return out;
}
