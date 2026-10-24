/**
 * SYNTHETIC test fixture: a scripted guided-intake scenario with two branches. ./demoCase.ts runs it
 * through the app's rule-based pipeline for the workspace view-model tests.
 */
import type { TransactionEvidence } from "../../lib/domain/schemas";

export type DemoBranch = "other_person" | "customer_sent";

export const DEMO_BRANCHES: { id: DemoBranch; label: string; caseId: string }[] = [
  { id: "other_person", label: "Someone else entered and sent it", caseId: "synthetic-demo-a" },
  { id: "customer_sent", label: "Customer sent it after instructions", caseId: "synthetic-demo-b" },
];

/** Fixed clock for the scenario (no real time is implied). */
export const DEMO_START = Date.UTC(2026, 9, 21, 15, 2, 0);
export const DEMO_RECORDS_AT = DEMO_START + 5_000;

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
export const DEMO_TRANSACTIONS: TransactionEvidence[] = [
  txn("demo-grocer-64", 64, "2026-10-12", "Demo Corner Grocer", "Groceries"),
  txn("demo-volt-389", 389, "2026-10-15", "Demo Volt Electronics", "Online electronics order"),
  txn("demo-giftcard-49", 49, "2026-10-19", "Demo GiftCard Hub", "Gift card purchase"),
  txn("demo-coffee-12", 12.5, "2026-10-20", "Demo Bean Coffee", "Coffee"),
];

export interface DemoBeat {
  id: string;
  title: string;
  narration: string;
  /** A customer reply recorded at this beat, `atSec` seconds after DEMO_START. */
  statement?: { text: string; atSec: number };
}

const SHARED: DemoBeat[] = [
  {
    id: "open",
    title: "Case opened",
    narration:
      "A synthetic case is opened and four fixture bank records are available to the matcher. The assistant opens the call by asking the customer what happened; that opening comes from its standing instructions, not from a recorded question.",
  },
  {
    id: "report",
    title: "Customer describes an unfamiliar payment",
    statement: { text: "There's a payment to GiftCard Hub on my account that I can't place. I only noticed it this morning.", atSec: 40 },
    narration:
      "The scripted extractor finds a payee (GiftCard Hub) but no amount or date. One fixture record matches that payee, but with no amount reported the matcher only calls it tentative. The rules therefore choose a confirmation question before anything else.",
  },
  {
    id: "confirm",
    title: "Customer confirms the payment",
    statement: { text: "Yes, that one.", atSec: 75 },
    narration:
      "“Yes, that one” carries no facts on its own. Read against the question it answered, it confirms the record, so the match becomes customer-confirmed. The next question asks who entered and sent the payment, because the review route depends on it.",
  },
];

const BRANCH: Record<DemoBranch, DemoBeat[]> = {
  other_person: [
    {
      id: "initiation",
      title: "Customer says someone else sent it",
      statement: { text: "No. Someone else did that. I didn't send it.", atSec: 110 },
      narration:
        "The working interpretation becomes “customer reports they did not make this payment”. It is reported and unverified. No blocking questions remain, so the draft route is a reimbursement review by a person. The rules still ask, as a non-blocking question, whether anyone requested a code or card details.",
    },
    {
      id: "follow-up",
      title: "Customer answers the follow-up",
      statement: { text: "No, nobody asked me for anything.", atSec: 150 },
      narration:
        "The reply is recorded as “nothing was shared”, which supports one condition of the curated Regulation E consideration. Other conditions remain unresolved. No customer questions are left, and a person reviews the draft. Nothing has been approved.",
    },
  ],
  customer_sent: [
    {
      id: "initiation",
      title: "Customer says they sent it",
      statement: { text: "Me. I did it myself.", atSec: 110 },
      narration:
        "The customer entered and sent the payment. That does not close the inquiry, and it does not mean there was no fraud. The facts don't fit a supported scenario yet, so the case needs manual review of the claim type. The next question asks what the customer believed the payment was for.",
    },
    {
      id: "follow-up",
      title: "Customer explains the instructions",
      statement: { text: "A man said he was from the bank's fraud team and told me to buy the gift card so my money would be safe.", atSec: 150 },
      narration:
        "The reply mentions being told what to do by someone claiming to be the bank. The rules record that as a reported scam sign and route the case to specialist review (escalate). This route is not a reimbursement decision either way.",
    },
  ],
};

const REVIEW: DemoBeat = {
  id: "review",
  title: "Reviewer inspects the case",
  narration:
    "Follow any reference chip to its source, check the decision trace, then try the review controls. Those controls are demo-only and are not saved.",
};

export function demoBeats(branch: DemoBranch): DemoBeat[] {
  return [...SHARED, ...BRANCH[branch], REVIEW];
}

/** Index of the first beat that differs between branches. */
export const DEMO_FORK_INDEX = SHARED.length;
