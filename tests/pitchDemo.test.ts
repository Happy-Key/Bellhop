import { describe, expect, it } from "vitest";
import { type CaseProposal } from "../lib/domain/caseDecision";
import { EMPTY_INVESTIGATION, diffInvestigations } from "../lib/domain/investigation";
import { PITCH_MATCHED_REF, PITCH_PROPOSAL, PITCH_REASONING, PITCH_TURNS } from "../lib/fixtures/pitchDemo";
import { buildPitchCase, resolveRef } from "../lib/review/pitchDemo";

describe("pitch demo (synthetic, scripted model outputs checked by real code)", () => {
  const c = buildPitchCase();

  it("matches the reported payment to the fixture record", () => {
    expect(c.analysis.match).toMatchObject({ outcome: "clear", matchedRef: PITCH_MATCHED_REF });
  });

  it("reads the pivot: the customer made the payment, after a reported scam contact, and shared the card details", () => {
    expect(c.analysis.facts.authorization).toMatchObject({ value: "authorized", statementRef: "S2" });
    expect(c.analysis.facts.scamIndicators.map((s) => s.statementRef)).toContain("S2");
    expect(c.analysis.facts.credentialSharing).toMatchObject({ value: "shared", statementRef: "S3" });
    expect(c.analysis.facts.conflicts).toEqual([]);
  });

  it("the scripted proposal passes the validator, agrees with the rule fallback, and moves no money", () => {
    expect(c.validation).toMatchObject({ ok: true, problems: [] });
    expect(c.analysis.recommendation.action).toBe(PITCH_PROPOSAL.decision);
    expect(c.plan.kind).toBe("automatic");
    expect(c.guardrails.every((g) => g.passed)).toBe(true);
  });

  it("an approval for this case would still need a person: AUTO-1 fails, starting with who made the payment", () => {
    expect(c.autoApproval.eligible).toBe(false);
    expect(c.autoApproval.checks.find((x) => x.id === "someone_else_sent_it")?.passed).toBe(false);
    expect(c.ifApproved.plan.kind).toBe("needs_person_to_approve");
  });

  it("the guardrails catch a bad proposal", () => {
    const bad: CaseProposal = { ...PITCH_PROPOSAL, decision: "deny", rationale: [{ point: "Customer sent it.", refs: ["S2", "S9"] }] };
    const r = buildPitchCase(bad);
    expect(r.validation.ok).toBe(false);
    expect(r.validation.problems.join(" ")).toMatch(/unknown evidence: S9/);
    expect(r.validation.problems.join(" ")).toMatch(/deny must cite a bank record/);
    expect(r.guardrails.find((g) => g.label === "Every citation resolves")?.passed).toBe(false);
  });

  it("every ref shown in the demo resolves to evidence", () => {
    const refs = [
      ...PITCH_PROPOSAL.rationale.flatMap((r) => r.refs),
      ...PITCH_PROPOSAL.legalBasis.map((l) => l.sourceRef),
      ...PITCH_REASONING.before.work.flatMap((w) => w.refs),
      ...PITCH_REASONING.after.work.flatMap((w) => w.refs),
      ...PITCH_PROPOSAL.investigation.workItems.flatMap((w) => w.refs),
      ...PITCH_PROPOSAL.investigation.findings.flatMap((f) => f.refs),
    ];
    for (const ref of refs) expect(resolveRef(c, ref).kind, ref).not.toBe("unknown");
  });

  it("the investigation evolves: the pivot completes the scam-type work and opens a new item, recorded by code", () => {
    const before = new Map(PITCH_REASONING.before.work.map((w) => [w.key, w.status]));
    expect(before.get("who_initiated")).toBe("awaiting_customer");
    const after = new Map(PITCH_REASONING.after.work.map((w) => [w.key, w.status]));
    expect(after.get("scam_type")).toBe("done");
    expect(after.get("card_exposure")).toBe("awaiting_customer");
    const changes = diffInvestigations(
      { investigation: { ...EMPTY_INVESTIGATION, workItems: PITCH_REASONING.before.work }, decision: "request_information" },
      { investigation: { ...EMPTY_INVESTIGATION, workItems: PITCH_REASONING.after.work }, decision: "request_information" },
    ).map((x) => x.text);
    expect(changes).toEqual(expect.arrayContaining([expect.stringMatching(/^Who made the payment established/), expect.stringMatching(/^Scam type assessed: Impostor/), "Started: Checking whether the card details were exposed"]));
    const accepted = c.validation.ok ? c.validation.proposal.investigation : null;
    expect(accepted?.findings.find((f) => f.refs.includes(PITCH_MATCHED_REF))?.basis).toBe("corroborated");
    expect(accepted?.hypotheses.map((h) => h.status)).toEqual(["supported", "ruled_out"]);
  });

  it("the agent's questions are the ones the customer's lines answer", () => {
    expect(PITCH_REASONING.before.nextQuestion).toBe(PITCH_TURNS[1]!.answers!.text);
    expect(PITCH_REASONING.after.nextQuestion).toBe(PITCH_TURNS[2]!.answers!.text);
  });
});
