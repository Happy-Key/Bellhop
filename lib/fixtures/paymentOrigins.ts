/**
 * SYNTHETIC payment-origin presets for the demo. A real bank would read these from its own
 * authentication logs; Nessie has none, so a reviewer attaches one to a transaction.
 */
import type { PaymentOrigin } from "../domain/schemas";
import { DEMO_CUSTOMER } from "./demo";

export const PAYMENT_ORIGIN_PRESETS = {
  /** Looks like the customer: their enrolled device, two-factor passed, near home. */
  customer_device: {
    label: "Customer's own device, two-factor passed, near home",
    origin: { channel: "card_not_present_online", device: "customer_enrolled_device", twoFactor: "passed", city: DEMO_CUSTOMER.address.city, state: DEMO_CUSTOMER.address.state },
  },
  /** Looks like account takeover: a new device, no two-factor, far from home. */
  new_device_far_away: {
    label: "New device, no two-factor, out of state",
    origin: { channel: "card_not_present_online", device: "new_device", twoFactor: "not_used", city: "Miami", state: "FL" },
  },
  /** Chip and PIN at a store near home. */
  chip_and_pin_near_home: {
    label: "Card present with chip and PIN, near home",
    origin: { channel: "card_present_chip_pin", device: "not_applicable", twoFactor: "not_used", city: DEMO_CUSTOMER.address.city, state: DEMO_CUSTOMER.address.state },
  },
} as const satisfies Record<string, { label: string; origin: Omit<PaymentOrigin, "txnRef" | "synthetic"> }>;

export type PaymentOriginPreset = keyof typeof PAYMENT_ORIGIN_PRESETS;
