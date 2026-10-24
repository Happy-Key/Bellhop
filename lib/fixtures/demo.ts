/**
 * SYNTHETIC demonstration data. No real people or accounts.
 * The Nessie seed script (scripts/seed-nessie.ts) creates these records in the shared
 * Nessie sandbox; tests use the same shapes offline.
 * NOTE: Nessie data is visible to other API users — never put real data here.
 */
export const DEMO_CUSTOMER = {
  first_name: "Jordan",
  last_name: "Synthetic-Rivera",
  address: { street_number: "100", street_name: "Demo Street", city: "Berkeley", state: "CA", zip: "94704" },
};

export const DEMO_CUSTOMER_LABEL = "Jordan Synthetic-Rivera (synthetic demo customer)";

export const DEMO_ACCOUNT = { type: "Checking", nickname: "FCI demo checking (synthetic)", rewards: 0, balance: 2500 };

export const DEMO_MERCHANTS = [
  { key: "grocer", name: "FCI Demo Corner Grocer", category: "food" },
  { key: "electronics", name: "FCI Demo Volt Electronics Online", category: "electronics" },
  { key: "giftcards", name: "FCI Demo GiftCard Hub", category: "retail" },
  { key: "coffee", name: "FCI Demo Bean Coffee", category: "food" },
] as const;

export type DemoMerchantKey = (typeof DEMO_MERCHANTS)[number]["key"];

/** Whole-dollar amounts because Nessie may store integers. Two $49 purchases create an ambiguity scenario. */
export const DEMO_PURCHASES: { merchant: DemoMerchantKey; amount: number; daysAgo: number; description: string }[] = [
  { merchant: "grocer", amount: 64, daysAgo: 9, description: "Groceries" },
  { merchant: "electronics", amount: 389, daysAgo: 6, description: "Online electronics order" },
  { merchant: "giftcards", amount: 49, daysAgo: 4, description: "Gift card purchase" },
  { merchant: "coffee", amount: 49, daysAgo: 3, description: "Coffee subscription" },
  { merchant: "grocer", amount: 23, daysAgo: 1, description: "Groceries" },
];

/** Suggested demo script (customer statements) for the dashboard. */
export const DEMO_STATEMENTS = [
  "I see a $389 charge from Volt Electronics that I did not make. I never shared my card or any codes.",
  "There's a $49 charge I don't recognize.",
  "Actually, it was the gift card one, at GiftCard Hub.",
  "Someone called pretending to be the bank and I sent $49 because they told me to.",
];
