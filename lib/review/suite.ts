/**
 * Claim suite verdicts: compares what a SYNTHETIC demo persona's case ended with against the
 * persona's expected result (lib/fixtures/demoPersonas.ts). Pure and browser-safe; the observation
 * is gathered by convex/suite.ts.
 *
 * The verdict checks what code decides: which record was matched, whether the claim was approved
 * automatically or went to a person, and that every AUTO-1 check the persona is built to trip did
 * fail. Further failing checks are listed as notes, not differences: a live case may surface more
 * than the scenario is about. A statement the provider couldn't read makes the run "incomplete",
 * since the outcome then reflects the outage, not the scenario. The reasoning model's proposed
 * disposition is reported next to it as advisory: a different but reasonable proposal is not a
 * failure, and the model never moves money outside AUTO-1 anyway.
 */
import type { PersonaExpectation } from "../fixtures/demoPersonas";

export interface SuiteObservation {
  /** Why the case isn't settled yet (still being set up, interpreted or reassessed), or null when it is. */
  pending: string | null;
  /** The persona purchase the case matched, or null when it matched none. */
  matchedKey: string | null;
  /** Failed AUTO-1 check ids, or null when the policy hasn't been evaluated. */
  failingChecks: string[] | null;
  autoApproved: boolean;
  /** Statements whose live interpretation failed, with the provider's error. */
  unreadStatements: { ref: string; error: string }[];
  /** rejected: the newest proposal failed validation (the guardrails worked); failed: the call itself failed. */
  model: { state: "off" | "none" | "pending" | "done" | "rejected" | "failed"; decision: string | null; problem: string | null };
}

export interface SuiteVerdict {
  verdict: "pending" | "pass" | "differs" | "incomplete";
  differences: string[];
  /** AUTO-1 checks that failed beyond the ones the scenario is built to trip (informational). */
  alsoFailed: string[];
  /** Whether the model's proposal is one of the reasonable ones; null when there is none. */
  modelReasonable: boolean | null;
}

export function suiteVerdict(expected: PersonaExpectation, disputedKey: string, o: SuiteObservation): SuiteVerdict {
  const modelReasonable = o.model.decision ? expected.reasonableDecisions.includes(o.model.decision as PersonaExpectation["reasonableDecisions"][number]) : null;
  if (o.pending) return { verdict: "pending", differences: [], alsoFailed: [], modelReasonable };
  const differences: string[] = [];
  const wantKey = expected.match === "none" ? null : disputedKey;
  if (o.matchedKey !== wantKey) differences.push(`Matched ${o.matchedKey ?? "no single record"}, expected ${wantKey ?? "no single record"}.`);
  const route = o.autoApproved ? "auto_approve" : "person";
  if (route !== expected.route) differences.push(o.autoApproved ? "Approved automatically, but a person should decide." : "Went to a person, but AUTO-1 should have approved it.");
  const failing = o.failingChecks ?? [];
  const alsoFailed = failing.filter((c) => !expected.failingChecks.includes(c as never));
  const missing = expected.failingChecks.filter((c) => !failing.includes(c));
  if (missing.length) differences.push(`Expected to fail but passed: ${missing.join(", ")}.`);
  if (o.unreadStatements.length) {
    differences.unshift(`Not comparable: ${o.unreadStatements.map((s) => s.ref).join(", ")} couldn't be read by the model (${o.unreadStatements[0]!.error}).`);
    return { verdict: "incomplete", differences, alsoFailed, modelReasonable };
  }
  // The scenarios assume a fresh account. An earlier run's payout makes the double-payment guard
  // (rightly) stop this one, which says nothing about the scenario.
  if (alsoFailed.includes("not_already_reimbursed")) {
    differences.unshift("Not comparable: an earlier run already reimbursed this payment, so the double-payment guard stopped it. Reset first: npm run reset:convex -- --confirm.");
    return { verdict: "incomplete", differences, alsoFailed, modelReasonable };
  }
  return { verdict: differences.length ? "differs" : "pass", differences, alsoFailed, modelReasonable };
}
