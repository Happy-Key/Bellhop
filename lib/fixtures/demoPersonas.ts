/**
 * SYNTHETIC DEMO PERSONAS for live demos (not a product feature).
 *
 * We have no customers on file, so each persona stands in for one: a Nessie customer and account
 * seeded with known purchases (`npm run seed:personas -- --confirm`), a published CRS test identity
 * whose results CRS documents in advance, and SYNTHETIC payment-origin records for each purchase.
 * Choosing a persona on /call sets its case up automatically (convex/personaSetup.ts), so the
 * outcome of a scripted call is known before it starts.
 *
 * Browser-safe and free of account IDs: the backend maps a persona to its Nessie account through
 * the NESSIE_PERSONA_ACCOUNTS Convex env var, so the client only ever names a persona.
 * Nessie data is visible to other API users, and CRS personas are public test identities.
 */
import type { PaymentOrigin } from "../domain/schemas";

export type PersonaOrigin = Omit<PaymentOrigin, "txnRef" | "synthetic">;

export interface PersonaPurchase {
  /** Stable key, used to label the payment-origin record. */
  key: string;
  merchant: string;
  /** Whole dollars (Nessie may store integers), unique within the persona so the amount alone identifies it. */
  amount: number;
  daysAgo: number;
  description: string;
  origin: PersonaOrigin;
}

export interface DemoPersona {
  id: string;
  name: string;
  /** CRS test identity (lib/fixtures/crsPersonas.ts; checked in tests/personas.test.ts, not imported, so the browser never loads CRS bodies). */
  crsPersonaId: string;
  home: { streetNumber: string; streetName: string; city: string; state: string; zip: string };
  scenario: string;
  /** What the case should end with when the script is followed. */
  expectedOutcome: string;
  merchants: { name: string; category: string }[];
  purchases: PersonaPurchase[];
  /** The purchase the customer disputes. */
  disputedKey: string;
  /** Suggested customer lines, in order. Questions in between come from the backend. */
  script: string[];
}

const ownDevice = (city: string, state: string): PersonaOrigin => ({ channel: "card_not_present_online", device: "customer_enrolled_device", twoFactor: "passed", city, state });
const chipNearHome = (city: string, state: string): PersonaOrigin => ({ channel: "card_present_chip_pin", device: "not_applicable", twoFactor: "not_used", city, state });
const newDevice = (city: string, state: string): PersonaOrigin => ({ channel: "card_not_present_online", device: "new_device", twoFactor: "not_used", city, state });

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: "margaret",
    name: "Margaret Okafor",
    crsPersonaId: "P01",
    home: { streetNumber: "1420", streetName: "Willow Creek Dr", city: "San Jose", state: "CA", zip: "95125" },
    scenario: "Account takeover: a small charge at a merchant she has never used, made from a new device out of state.",
    expectedOutcome: "Approved automatically (all 14 AUTO-1 checks pass), then a SIMULATED $58 deposit.",
    merchants: [
      { name: "FCI Demo Willow Market", category: "food" },
      { name: "FCI Demo Daybreak Coffee", category: "food" },
      { name: "FCI Demo PixelPlay Games", category: "entertainment" },
    ],
    purchases: [
      { key: "groceries", merchant: "FCI Demo Willow Market", amount: 86, daysAgo: 12, description: "Groceries", origin: chipNearHome("San Jose", "CA") },
      { key: "coffee", merchant: "FCI Demo Daybreak Coffee", amount: 7, daysAgo: 5, description: "Coffee", origin: chipNearHome("San Jose", "CA") },
      { key: "games", merchant: "FCI Demo PixelPlay Games", amount: 58, daysAgo: 1, description: "Online game credits", origin: newDevice("Las Vegas", "NV") },
    ],
    disputedKey: "games",
    script: [
      "Hi, there's a $58 charge from PixelPlay Games on my account that I didn't make.",
      "No, I never gave anyone a code or my card details.",
    ],
  },
  {
    id: "grace",
    name: "Grace Nakamura",
    crsPersonaId: "P19",
    home: { streetNumber: "1850", streetName: "Solano Ave", city: "Berkeley", state: "CA", zip: "94707" },
    scenario: "Disputes a charge the bank's records show was made on her own enrolled phone, with two-factor passed, near home.",
    expectedOutcome: "Goes to a person: the payment-origin check fails (it points to the customer). Never denied automatically.",
    merchants: [
      { name: "FCI Demo Solano Grocers", category: "food" },
      { name: "FCI Demo Northside Pharmacy", category: "health" },
      { name: "FCI Demo Lumen Home Goods", category: "home" },
    ],
    purchases: [
      { key: "groceries", merchant: "FCI Demo Solano Grocers", amount: 112, daysAgo: 10, description: "Groceries", origin: chipNearHome("Berkeley", "CA") },
      { key: "pharmacy", merchant: "FCI Demo Northside Pharmacy", amount: 24, daysAgo: 6, description: "Pharmacy", origin: chipNearHome("Berkeley", "CA") },
      { key: "homegoods", merchant: "FCI Demo Lumen Home Goods", amount: 72, daysAgo: 2, description: "Online home goods order", origin: ownDevice("Berkeley", "CA") },
    ],
    disputedKey: "homegoods",
    script: [
      "Hello, I see a $72 charge at Lumen Home Goods that I didn't make.",
      "No, I didn't give anyone a code or my password.",
    ],
  },
  {
    id: "victor",
    name: "Victor Anand",
    crsPersonaId: "P12",
    home: { streetNumber: "55", streetName: "Water St Fl 20", city: "New York", state: "NY", zip: "10041" },
    scenario: "A small charge from a new device out of state, but the claimant's identity doesn't verify and their contact details score high risk.",
    expectedOutcome: "Goes to a person: the CRS identity check fails and Fraud Finder scores 85 (high). Not evidence the claim is false, and never denied automatically.",
    merchants: [
      { name: "FCI Demo Water Street Deli", category: "food" },
      { name: "FCI Demo Hudson Transit", category: "transport" },
      { name: "FCI Demo QuickRide Rentals", category: "transport" },
    ],
    purchases: [
      { key: "deli", merchant: "FCI Demo Water Street Deli", amount: 15, daysAgo: 8, description: "Lunch", origin: chipNearHome("New York", "NY") },
      { key: "transit", merchant: "FCI Demo Hudson Transit", amount: 33, daysAgo: 5, description: "Transit pass", origin: ownDevice("New York", "NY") },
      { key: "rental", merchant: "FCI Demo QuickRide Rentals", amount: 45, daysAgo: 1, description: "Scooter rental", origin: newDevice("Chicago", "IL") },
    ],
    disputedKey: "rental",
    script: [
      "Yeah, there's a $45 charge from QuickRide Rentals that I didn't make.",
      "No, I never gave anybody a code or my card number.",
    ],
  },
  {
    id: "samuel",
    name: "Samuel Oyelaran",
    crsPersonaId: "P16",
    home: { streetNumber: "1200", streetName: "Brickell Bay Dr Apt 2203", city: "Miami", state: "FL", zip: "33131" },
    scenario: "Bank-impostor scam: a caller posing as the bank's fraud team talked him into buying a gift card himself.",
    expectedOutcome: "Escalated to specialist scam review: he made the payment himself after being deceived, so it is not automatically reimbursable.",
    merchants: [
      { name: "FCI Demo Brickell Bistro", category: "food" },
      { name: "FCI Demo Bayside Fuel", category: "auto" },
      { name: "FCI Demo GiftCard Depot", category: "retail" },
    ],
    purchases: [
      { key: "bistro", merchant: "FCI Demo Brickell Bistro", amount: 41, daysAgo: 9, description: "Dinner", origin: chipNearHome("Miami", "FL") },
      { key: "fuel", merchant: "FCI Demo Bayside Fuel", amount: 52, daysAgo: 4, description: "Fuel", origin: chipNearHome("Miami", "FL") },
      { key: "giftcard", merchant: "FCI Demo GiftCard Depot", amount: 95, daysAgo: 1, description: "Gift card purchase", origin: ownDevice("Miami", "FL") },
    ],
    disputedKey: "giftcard",
    script: [
      "Someone called pretending to be from my bank's fraud team, and I paid $95 for a gift card at GiftCard Depot because they told me to.",
      "Yes, I did it myself.",
      "They said it would keep my money safe while they fixed my account.",
    ],
  },
];

export function getDemoPersona(id: string | null | undefined): DemoPersona | undefined {
  return id ? DEMO_PERSONAS.find((p) => p.id === id) : undefined;
}

export const personaLabel = (p: DemoPersona) => `${p.name} (SYNTHETIC demo persona; CRS test identity ${p.crsPersonaId})`;

/** The persona purchase a retrieved Nessie record is, by merchant name and amount (both unique within a persona). */
export function personaPurchaseFor(p: DemoPersona, t: { merchantName: string | null; amount: number }): PersonaPurchase | undefined {
  return p.purchases.find((x) => x.merchant === t.merchantName && x.amount === t.amount);
}
