import { describe, expect, it } from "vitest";
import { suiteVerdict, type SuiteObservation } from "@/lib/review/suite";
import { getDemoPersona } from "@/lib/fixtures/demoPersonas";

const settled = (o: Partial<SuiteObservation>): SuiteObservation => ({
  pending: null,
  matchedKey: null,
  failingChecks: [],
  autoApproved: false,
  model: { state: "done", decision: null, problem: null },
  ...o,
});

describe("claim suite verdicts", () => {
  const daniel = getDemoPersona("daniel")!;
  const margaret = getDemoPersona("margaret")!;
  const elena = getDemoPersona("elena")!;

  it("passes when the matched record, failing checks and route are as expected, whatever their order", () => {
    const v = suiteVerdict(daniel.expected, daniel.disputedKey, settled({ matchedKey: "stream-3", failingChecks: ["no_prior_payments_to_merchant"], model: { state: "done", decision: "request_information", problem: null } }));
    expect(v).toEqual({ verdict: "pass", differences: [], modelReasonable: true });
    expect(suiteVerdict(margaret.expected, margaret.disputedKey, settled({ matchedKey: "games", autoApproved: true })).verdict).toBe("pass");
  });

  it("names each difference: route, extra and missing checks, matched record", () => {
    const v = suiteVerdict(daniel.expected, daniel.disputedKey, settled({ matchedKey: "groceries", failingChecks: ["fraud_risk_low"], autoApproved: false }));
    expect(v.verdict).toBe("differs");
    expect(v.differences).toEqual([
      "Matched groceries, expected stream-3.",
      "Also failed: fraud_risk_low.",
      "Expected to fail but passed: no_prior_payments_to_merchant.",
    ]);
    expect(suiteVerdict(daniel.expected, daniel.disputedKey, settled({ matchedKey: "stream-3", failingChecks: [], autoApproved: true })).differences).toContain(
      "Approved automatically, but a person should decide.",
    );
  });

  it("expects no single match for a several-payment report, waits while pending, and treats the model as advisory", () => {
    expect(suiteVerdict(elena.expected, elena.disputedKey, settled({ matchedKey: null, failingChecks: [...elena.expected.failingChecks] })).verdict).toBe("pass");
    expect(suiteVerdict(daniel.expected, daniel.disputedKey, settled({ pending: "A statement is still being interpreted." })).verdict).toBe("pending");
    const v = suiteVerdict(daniel.expected, daniel.disputedKey, settled({ matchedKey: "stream-3", failingChecks: ["no_prior_payments_to_merchant"], model: { state: "done", decision: "deny", problem: null } }));
    expect(v).toMatchObject({ verdict: "pass", modelReasonable: false });
  });
});
