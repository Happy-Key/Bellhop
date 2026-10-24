import { describe, expect, it } from "vitest";
import { looksLikeCorrection } from "../lib/domain/interpret";
import { DEMO_FORK_INDEX, demoBeats, type DemoBranch } from "../lib/fixtures/guidedIntakeDemo";
import type { StoredAnalysis } from "../lib/domain/triage";
import { buildDemoState, type DemoState } from "../lib/review/demoCase";

const analysisOf = (s: DemoState) => s.view.case.analysis as StoredAnalysis;

const last = (branch: DemoBranch) => buildDemoState(branch, demoBeats(branch).length - 1);

describe("guided-intake demo (synthetic, scripted)", () => {
  it("opens with no statements, the fixture records retrieved, and nothing matched", () => {
    const s = buildDemoState("other_person", 0);
    expect(s.view.statements).toHaveLength(0);
    expect(s.view.case.bankFetch).toMatchObject({ status: "ok", count: 4 });
    expect(analysisOf(s).stage).toBe("intake");
  });

  it("asks to confirm a tentative candidate, then asks who entered and sent the payment", () => {
    const s = buildDemoState("other_person", DEMO_FORK_INDEX - 1);
    const [report, confirm] = s.snapshots;
    expect(report!.next).toMatchObject({ key: "tentative:T:demo-giftcard-49", kind: "tentative_match", audience: "customer" });
    expect(s.view.statements[0]!.inResponseTo).toBeUndefined();
    expect(s.view.statements[1]!.inResponseTo?.key).toBe("tentative:T:demo-giftcard-49");
    expect(s.view.statements[1]!.answer).toMatchObject({ state: "answered", derived: { confirmsTxnRef: "T:demo-giftcard-49" } });
    expect(confirm!.next).toMatchObject({ key: "initiation" });
    // Once matched, the question names the payment.
    expect(confirm!.next!.text).toMatch(/^Did you make the \$49\.00 payment to .*GiftCard Hub.* yourself, or did someone else make it\?$/);
    expect(analysisOf(s).match).toMatchObject({ outcome: "clear", matchedRef: "T:demo-giftcard-49" });
  });

  it("branch A: someone else sent it → credentials question, then reimbursement review by a person", () => {
    const s = last("other_person");
    const [, , initiation, followUp] = s.snapshots;
    expect(s.view.statements[2]!.answer?.derived?.authorization).toBe("denies_authorization");
    expect(initiation!.next).toMatchObject({ key: "credentials", blocking: false });
    expect(s.view.statements[3]!.answer?.derived?.credentialSharing).toBe("not_shared");
    expect(followUp!.next).toBeNull();
    const a = analysisOf(s);
    expect(a.stage).toBe("human_review");
    expect(a.recommendation.action).toBe("reimbursement_review");
    expect(a.considerations.map((c) => c.sourceRef)).toContain("R:reg-e.1005.2m");
  });

  it("branch B: customer sent it → purpose question, then specialist review (not a reimbursement decision)", () => {
    const s = last("customer_sent");
    const [, , initiation, followUp] = s.snapshots;
    expect(s.view.statements[2]!.answer?.derived?.authorization).toBe("authorized");
    expect(initiation!.stage).toBe("assess_considerations");
    expect(initiation!.next).toMatchObject({ key: "payment_purpose" });
    expect(followUp!.next).toBeNull();
    const a = analysisOf(s);
    expect(a.facts.scamIndicators.length).toBeGreaterThan(0);
    expect(a.recommendation.action).toBe("escalate");
    expect(a.considerations.map((c) => c.sourceRef)).toEqual(expect.arrayContaining(["R:reg-e.1005.2m", "R:policy.demo-scam-review"]));
  });

  it("uses fixed inputs: the same step always gives the same case, and no reply is read as a correction", () => {
    expect(buildDemoState("customer_sent", 4)).toEqual(buildDemoState("customer_sent", 4));
    for (const b of ["other_person", "customer_sent"] as const) for (const beat of demoBeats(b)) if (beat.statement) expect(looksLikeCorrection(beat.statement.text)).toBe(false);
  });
});
