import { describe, expect, it } from "vitest";
import type { StoredAnalysis } from "../lib/domain/triage";
import { demoBeats } from "./helpers/guidedIntakeDemo";
import { buildDemoState } from "./helpers/demoCase";
import { intakeProgress } from "../lib/review/intake";
import { buildTimeline } from "../lib/review/timeline";
import type { CaseView } from "../lib/review/types";
import { decisionTrace, groupFindings, preparedOutputs, reconciliation } from "../lib/review/workspace";

const final = buildDemoState("other_person", demoBeats("other_person").length - 1);
const analysis = final.view.case.analysis as StoredAnalysis;

/** A view with states the demo doesn't cover: a pending interpretation, an "I don't know", a superseded record. */
function edgeView(): CaseView {
  const base = buildDemoState("other_person", 2).view;
  const [s1, s2] = base.statements;
  const unknown = { ...s2!, _id: "x-s3" as never, ref: "S3", text: "I don't know.", receivedAt: s2!.receivedAt + 10_000, inResponseTo: { key: "initiation", kind: "initiation", text: "Who sent it?" }, answer: { key: "initiation", kind: "initiation", state: "unknown" as const, parser: "answer-slot-parser@1" } };
  const pending = { ...s1!, _id: "x-s4" as never, ref: "S4", text: "Also there was another one.", receivedAt: s2!.receivedAt + 20_000, interpretation: null, interpretationStatus: "pending" as const };
  const old = { ...base.transactions[0]!, _id: "x-t-old" as never, status: "pending", supersededAt: base.transactions[0]!.retrievedAt + 1 };
  return { ...base, statements: [s1!, s2!, unknown, pending], history: { transactions: [old], providerEvidence: [] } };
}

describe("guided intake view", () => {
  it("attaches each short reply to the question it answered and records what was read from it", () => {
    const p = intakeProgress(final.view.statements, analysis);
    expect(p.turns.map((t) => t.state)).toEqual(["opening", "answered", "answered", "answered"]);
    expect(p.turns[1]).toMatchObject({ asked: { key: "tentative:T:demo-giftcard-49", refs: ["T:demo-giftcard-49"] }, reply: { text: "Yes, that one." } });
    expect(p.turns[1]!.established).toContainEqual({ field: "confirms", value: "T:demo-giftcard-49", via: "reply_parser" });
    expect(p.turns[2]!.asked?.why).toMatch(/route depends on/);
    expect(p.next).toEqual({ status: "complete" });
  });

  it("shows the next customer question from the analysis, by stable key", () => {
    const p = intakeProgress(buildDemoState("customer_sent", 3).view.statements, buildDemoState("customer_sent", 3).view.case.analysis as StoredAnalysis);
    expect(p.next).toMatchObject({ status: "question", question: { key: "payment_purpose" } });
  });

  it("never offers a next question while an interpretation is pending, and keeps unknown answers honest", () => {
    const v = edgeView();
    const p = intakeProgress(v.statements, v.case.analysis as StoredAnalysis);
    expect(p.next).toEqual({ status: "awaiting_interpretation", refs: ["S4"] });
    expect(p.turns.find((t) => t.ref === "S3")?.state).toBe("unknown");
    expect(p.turns.find((t) => t.ref === "S4")).toMatchObject({ interpretation: "pending", established: [] });
  });

  it("waits for a report when there are no statements", () => {
    expect(intakeProgress([], null).next).toEqual({ status: "awaiting_report" });
  });
});

describe("timeline view", () => {
  it("merges statements, date-only records and actions without inventing times", () => {
    const events = buildTimeline(final.view, { recordSource: "Fixture (demo)" });
    const record = events.find((e) => e.refs[0] === "T:demo-giftcard-49" && e.cls === "observed")!;
    expect(record).toMatchObject({ at: null, date: "2026-10-19", label: "Bank record" });
    expect(events.find((e) => e.refs[0] === "S2")).toMatchObject({ cls: "reported", label: "Answer", question: expect.stringContaining("Is this the payment") });
    expect(events.some((e) => e.label === "Reviewer")).toBe(false);
    expect(events.map((e) => e.sortAt)).toEqual([...events.map((e) => e.sortAt)].sort((a, b) => a - b));
  });

  it("labels demo reviewer actions and superseded record versions", () => {
    const events = buildTimeline(edgeView(), { recordSource: "Nessie (live)", reviewEvents: [{ id: "1", at: Date.UTC(2026, 9, 21, 16), action: "override", reason: "Needs a call", stepKey: null }] });
    expect(events.find((e) => e.label === "Reviewer")).toMatchObject({ demoOnly: true, text: "Recorded an override: Needs a call", cls: "action" });
    expect(events.find((e) => e.label === "Record version superseded")).toMatchObject({ cls: "observed" });
  });
});

describe("workspace views", () => {
  it("separates confirmed, tentative and excluded records", () => {
    expect(reconciliation(analysis, "T:demo-giftcard-49")).toEqual({ state: "confirmed", confirmedBy: "S2" });
    const tentative = buildDemoState("other_person", 1).view.case.analysis as StoredAnalysis;
    expect(reconciliation(tentative, "T:demo-giftcard-49").state).toBe("tentative");
    expect(reconciliation(tentative, "T:demo-volt-389").state).toBe("unrelated");
  });

  it("groups findings into supported, missing, conflicting and superseded", () => {
    const g = groupFindings(edgeView(), buildDemoState("other_person", 2).view.case.analysis as StoredAnalysis);
    expect(g.supported.some((f) => f.kind === "observed")).toBe(true);
    expect(g.missing.some((f) => f.id === "initiation" && f.audience === "customer" && f.blocking)).toBe(true);
    expect(g.superseded).toHaveLength(1);
    expect(g.conflicting).toEqual([]);
  });

  it("traces the draft route to facts, typed sources and unresolved conditions", () => {
    const t = decisionTrace(final.view, analysis);
    expect(t.factsUsed.length).toBeGreaterThan(0);
    expect(t.sources.find((s) => s.ref === "R:reg-e.1005.2m")).toMatchObject({ kind: "regulation", synthetic: false });
    expect(t.unresolved.some((u) => /benefit/.test(u.text))).toBe(true);
    expect(t.blocking).toEqual([]);
    const b = buildDemoState("customer_sent", demoBeats("customer_sent").length - 1).view;
    expect(decisionTrace(b, b.case.analysis as StoredAnalysis).sources.find((s) => s.kind === "institution_policy")).toMatchObject({ synthetic: true });
  });

  it("marks outputs honestly: no template, not yet applicable, or a labelled preview", () => {
    const done = preparedOutputs(analysis);
    expect(done.find((o) => o.id === "investigation_summary")).toMatchObject({ state: "ready_for_review", preview: false });
    expect(done.find((o) => o.id === "information_request")?.state).toBe("not_yet_applicable");
    expect(done.find((o) => o.id === "acknowledgment")?.state).toBe("no_template");
    const asking = preparedOutputs(buildDemoState("other_person", 1).view.case.analysis as StoredAnalysis);
    expect(asking.find((o) => o.id === "information_request")).toMatchObject({ state: "draft_prepared", preview: true });
    expect(preparedOutputs(null).every((o) => o.state !== "ready_for_review")).toBe(true);
  });
});
