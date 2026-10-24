/**
 * SYNTHETIC DEMO — the scripted scenario replayed by the pitch demo (/review/demo).
 *
 * For presentation reliability, the customer's lines and the reasoning model's outputs are
 * prewritten here. They are shaped like the real ones (statements, and a CaseProposal as Bitdeer
 * returns it) so lib/review/pitchDemo.ts can run them through the app's real guardrails:
 * analyzeCase, validateProposal, executionPlan and policy AUTO-1. Nothing is stored or sent.
 */
import type { CaseProposal } from "../domain/caseDecision";
import type { WorkItem } from "../domain/investigation";
import type { AskedQuestion, TransactionEvidence } from "../domain/schemas";

/** Fixed clock for the scenario (no real time is implied). */
export const PITCH_START = Date.UTC(2026, 9, 21, 15, 2, 0);

const txn = (id: string, amount: number, date: string, merchantName: string, description: string): TransactionEvidence => ({
  ref: `T:${id}`,
  provider: "nessie",
  externalId: id,
  kind: "purchase",
  amount,
  date,
  description,
  merchantId: null,
  merchantName,
  status: "executed",
  medium: "balance",
});

/** Fixture records in the Nessie shape. Not retrieved from Nessie. */
export const PITCH_TRANSACTIONS: TransactionEvidence[] = [
  txn("demo-grocer-64", 64, "2026-10-12", "Demo Corner Grocer", "Groceries"),
  txn("demo-volt-389", 389, "2026-10-15", "Demo Volt Electronics", "Online electronics order"),
  txn("demo-giftcard-49", 49, "2026-10-19", "Demo GiftCard Hub", "Gift card purchase"),
  txn("demo-coffee-12", 12.5, "2026-10-20", "Demo Bean Coffee", "Coffee"),
];

export const PITCH_MATCHED_REF = "T:demo-giftcard-49";

/** One step of the agent's reasoning, as the model would state it. */
export interface PitchReasoning {
  interpretation: string;
  /** The investigative work the model has planned at this point. */
  work: WorkItem[];
  nextQuestion: string;
  why: string;
}

const w = (key: string, title: string, doneTitle: string, detail: string, status: WorkItem["status"], outcome: string | null, refs: string[]): WorkItem => ({ key, title, doneTitle, detail, status, outcome, refs });

const IDENTIFIED = w("identify_payment", "Identifying the disputed payment", "Disputed payment identified", "Comparing the customer's description with the account's records.", "done", "$49.00 Demo GiftCard Hub purchase on Oct 19.", ["S1", "T:demo-giftcard-49"]);

export interface PitchTurn {
  ref: string;
  atSec: number;
  text: string;
  /** The question this line answers (absent for the opening report). */
  answers?: AskedQuestion;
}

export const PITCH_TURNS: PitchTurn[] = [
  { ref: "S1", atSec: 40, text: "There's a $49 charge to GiftCard Hub on my account and I don't know what it is." },
  {
    ref: "S2",
    atSec: 80,
    text: "I did, yes. A man from the bank's fraud team called and told me to buy it so my money would be safe.",
    answers: { key: "confirm:authorization", kind: "initiation", text: "Did you make that purchase yourself?" },
  },
  {
    ref: "S3",
    atSec: 120,
    text: "Yes, I read him the card number and PIN from the back.",
    answers: { key: "credentials", kind: "credential_sharing", text: "Did you give the caller the gift card number or PIN?" },
  },
];

/** The model's working interpretation after S1, then after S2 (the turn that changes it). */
export const PITCH_REASONING: { before: PitchReasoning; after: PitchReasoning } = {
  before: {
    interpretation: "Possible unauthorized payment",
    work: [IDENTIFIED, w("who_initiated", "Establishing who made the payment", "Who made the payment established", "Who entered and sent it decides which rules apply.", "awaiting_customer", null, [])],
    nextQuestion: PITCH_TURNS[1]!.answers!.text,
    why: "Who made the payment decides which rules apply.",
  },
  after: {
    interpretation: "Customer-sent payment, induced by a bank impersonator",
    work: [
      IDENTIFIED,
      w("who_initiated", "Establishing who made the payment", "Who made the payment established", "Who entered and sent it decides which rules apply.", "done", "The customer, on a caller's instructions.", ["S2"]),
      w("scam_type", "Assessing scam type", "Scam type assessed", "Comparing the customer's account with the payment to choose the handling framework.", "done", "Impostor scam: the caller posed as the bank's fraud team.", ["S2"]),
      w("card_exposure", "Checking whether the card details were exposed", "Card exposure checked", "Decides whether the balance may still be recoverable.", "awaiting_customer", null, []),
    ],
    nextQuestion: PITCH_TURNS[2]!.answers!.text,
    why: "If the caller has the card details, the balance may already be spent. That changes what can be recovered.",
  },
};

/** The model's whole-case proposal after S3, in the CaseProposalOutput shape. */
export const PITCH_PROPOSAL: CaseProposal = {
  decision: "escalate",
  summary:
    "The customer bought a $49.00 gift card on a caller's instructions after the caller claimed to be the bank's fraud team, then read out the card number and PIN. Route to the scam specialist for a discretionary reimbursement review.",
  rationale: [
    { point: "The disputed payment is the $49.00 Demo GiftCard Hub purchase on Oct 19; the customer identified it.", refs: ["S1", PITCH_MATCHED_REF] },
    { point: "The customer made the purchase themselves, on instructions from someone posing as the bank.", refs: ["S2"] },
    { point: "The customer then gave the caller the card number and PIN, so the balance may already be redeemed.", refs: ["S3"] },
    { point: "Bank policy routes payments the customer made after being deceived to a specialist; reimbursement is discretionary.", refs: ["R:policy.demo-scam-review"] },
  ],
  legalBasis: [
    { sourceRef: "R:reg-e.1005.2m", reading: "likely_does_not_apply", note: "The customer initiated the purchase, so it is unlikely to be an unauthorized transfer under this definition." },
    { sourceRef: "R:policy.demo-scam-review", reading: "likely_applies", note: "Customer-initiated payment after deception by an impersonator." },
    { sourceRef: "R:reg-e.1005.11", reading: "unclear", note: "Whether error-resolution duties apply depends on the specialist's finding." },
  ],
  investigation: {
    findings: [
      { text: "The disputed payment is the $49.00 Demo GiftCard Hub purchase on Oct 19.", basis: "corroborated", refs: ["S1", PITCH_MATCHED_REF] },
      { text: "The customer made the purchase on a caller's instructions.", basis: "reported", refs: ["S2"] },
      { text: "The customer read the card number and PIN to the caller.", basis: "reported", refs: ["S3"] },
    ],
    hypotheses: [
      { text: "Impostor scam: the caller posed as the bank", status: "supported", refs: ["S2"] },
      { text: "Someone else made the payment without the customer", status: "ruled_out", refs: ["S2"] },
    ],
    uncertainties: [
      { text: "When the call happened and the number it came from", blocking: false },
      { text: "Whether the gift card balance has been redeemed", blocking: false },
    ],
    workItems: [
      ...PITCH_REASONING.after.work.filter((x) => x.key !== "card_exposure"),
      w("card_exposure", "Checking whether the card details were exposed", "Card exposure checked", "Decides whether the balance may still be recoverable.", "done", "Card number and PIN given to the caller.", ["S3"]),
      w("handling", "Choosing the handling route", "Handling route chosen", "Matching the facts to the bank's rules and policies.", "done", "Scam specialist review under policy DP-1.", ["R:policy.demo-scam-review"]),
    ],
    rulesConsulted: [
      { ruleId: "R-E01", why: "Ruled out: the customer, not someone else, entered and sent the payment." },
      { ruleId: "R-E03", why: "Customer-initiated payment induced by deception: no federal reimbursement rule, so specialist and bank policy." },
    ],
    changes: [{ text: "The customer made the payment themselves after a call from someone posing as the bank, so the unauthorized-payment route was ruled out and scam review applies.", refs: ["S2"] }],
  },
  nextQuestion: null,
  documents: [
    {
      kind: "investigation_summary",
      text:
        "Reported 2026-10-21 15:02 UTC by voice. Payment: $49.00 to Demo GiftCard Hub on 2026-10-19 (T:demo-giftcard-49), identified by the customer (S1). The customer made the purchase on instructions from a caller claiming to be the bank's fraud team (S2), then read the card number and PIN to the caller (S3). Proposed route: scam specialist review under policy DP-1. Open: call time and number; card redemption status.",
    },
    {
      kind: "customer_letter",
      text:
        "Thank you for reporting this. We have opened a review of the $49.00 Demo GiftCard Hub purchase on October 19. A fraud specialist will contact you about next steps. Our bank will never ask you to buy gift cards or move money to keep it safe. If someone asks, hang up and call the number on your card.",
    },
    {
      kind: "information_request",
      text: "To help the specialist, please tell us roughly when the call happened and the number it came from, if you have it.",
    },
  ],
};
