/**
 * The customer's side of a SYNTHETIC persona conversation (demo and test aid). Given the question
 * the assistant actually asked, answer it from the persona's sheet (lib/fixtures/demoPersonas.ts),
 * never by reading the next line of a fixed script.
 *
 * - `answerRuleQuestion`: deterministic answers to every kind of question the rules ask (used by
 *   tests/personas.test.ts). Returns null when the sheet can't answer, so a test can fail loudly.
 * - `customerBrief`: everything the customer knows, for the simulated customer the live suite
 *   runner uses (lib/providers/customerSimulator.ts), which can answer free-form model questions.
 */
import type { QuestionKind } from "../domain/schemas";
import type { DemoPersona } from "./demoPersonas";

export const NOT_SHARED = "No, I never gave anyone a code, a password or my card details.";
export const DID_NOT_MAKE = "No, I didn't make it. Someone else must have.";
export const NOTHING_TO_ADD = "No, that's everything.";

const short = (merchant: string) => merchant.replace(/^FCI Demo /, "");

function whenSaid(daysAgo: number): string {
  if (daysAgo <= 1) return "Yesterday.";
  if (daysAgo <= 6) return `About ${daysAgo} days ago.`;
  if (daysAgo <= 13) return "About a week ago.";
  if (daysAgo <= 45) return `About ${Math.round(daysAgo / 7)} weeks ago.`;
  return `A couple of months ago, about ${daysAgo} days back.`;
}

const disputed = (p: DemoPersona) => p.purchases.find((x) => x.key === p.disputedKey)!;

/** Does a question that proposes a payment ("Is it the $42.00 payment to FCI Demo Metro Parking...?") name the disputed one? */
function namesDisputed(p: DemoPersona, text: string): boolean {
  const d = disputed(p);
  return text.includes(d.merchant) && (text.includes(`$${d.amount}.00`) || text.includes(`$${d.amount} `) || text.includes(`$${d.amount}?`));
}

const whichPayment = (p: DemoPersona) => p.customer.whichPayment ?? `It's the $${disputed(p).amount} one, from ${short(disputed(p).merchant)}.`;

/** The answer to a rule-based question (kind and key from lib/domain/workflow.ts), or null if the sheet can't give one. */
export function answerRuleQuestion(p: DemoPersona, q: { kind: QuestionKind | string; key: string; text: string }): string | null {
  const c = p.customer;
  const d = disputed(p);
  switch (q.kind) {
    case "narrative":
      return c.opening;
    case "missing_transaction_details":
      if (q.key === "details:amount") return `$${d.amount}.`;
      if (q.key === "details:merchant") return `${short(d.merchant)}.`;
      if (q.key === "details:date") return whenSaid(d.daysAgo);
      return null;
    case "ambiguous_match":
    case "tentative_match":
    case "multiple_amounts":
      if (q.key.startsWith("tentative:")) return namesDisputed(p, q.text) ? (c.whichPayment && p.alsoDisputedKeys?.length ? c.whichPayment : "Yes, that's the one.") : `No. ${whichPayment(p)}`;
      return whichPayment(p);
    case "no_match":
      return `${whichPayment(p)} ${whenSaid(d.daysAgo)}`;
    case "conflict":
      return c.conflict ?? c.initiation ?? null;
    case "initiation":
      return c.initiation ?? DID_NOT_MAKE;
    case "credential_sharing":
      return c.credentials ?? NOT_SHARED;
    case "code_purpose":
      return c.codePurpose ?? null;
    case "payment_purpose":
      return c.paymentPurpose ?? null;
    default:
      return null;
  }
}

/** The answer sheet as "if asked … say …" pairs, for the presenter notes on /call and the simulated customer. */
export function customerSheet(p: DemoPersona): { when: string; say: string }[] {
  const c = p.customer;
  return [
    { when: "Who made the payment", say: c.initiation ?? DID_NOT_MAKE },
    { when: "Whether you gave anyone a code, password or card details", say: c.credentials ?? NOT_SHARED },
    ...(c.codePurpose ? [{ when: "What the code was for", say: c.codePurpose }] : []),
    ...(c.paymentPurpose ? [{ when: "What the payment was for", say: c.paymentPurpose }] : []),
    ...(c.conflict ? [{ when: "To clear up a contradiction", say: c.conflict }] : []),
    { when: "Which payment you mean", say: whichPayment(p) },
    { when: "Anything else to add", say: NOTHING_TO_ADD },
  ];
}

/** Everything the simulated customer knows, as plain sentences. */
export function customerBrief(p: DemoPersona): string {
  const c = p.customer;
  const d = disputed(p);
  const others = p.purchases.filter((x) => x.key !== d.key && !(p.alsoDisputedKeys ?? []).includes(x.key));
  const lines = [
    `You are ${p.name}, a bank customer in ${p.home.city}, ${p.home.state}, reporting a payment to your bank's fraud line.`,
    `You opened with: "${c.opening}"`,
    `The payment you dispute: $${d.amount} to ${short(d.merchant)}, ${whenSaid(d.daysAgo).toLowerCase().replace(/\.$/, "")}.`,
    ...(p.alsoDisputedKeys?.length ? [`You also dispute: ${p.alsoDisputedKeys.map((k) => p.purchases.find((x) => x.key === k)!).map((x) => `$${x.amount} to ${short(x.merchant)}`).join(", ")}.`] : []),
    `Your other recent payments, which are yours and fine: ${others.map((x) => `$${x.amount} at ${short(x.merchant)}`).join(", ") || "none"}.`,
    ...customerSheet(p).map((x) => `If asked ${x.when.charAt(0).toLowerCase()}${x.when.slice(1)}: "${x.say}"`),
    ...(c.facts ?? []),
  ];
  return lines.join("\n");
}
