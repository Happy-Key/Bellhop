/**
 * View-model adapter for the SYNTHETIC guided-intake demo (/review/demo).
 *
 * Runs the scripted fixture (lib/fixtures/guidedIntakeDemo.ts) through the same pure functions the
 * backend uses: the scripted extractor, the reply parser, analyzeCase and selectVoiceQuestion. The
 * result has the shape of `cases.view`, so the workspace renders it with the same components as a
 * live case. There are no Convex, Nessie or model calls, and nothing is stored.
 */
import type { Id } from "../../convex/_generated/dataModel";
import { interpretAnswer, relatedRefFromKey } from "../domain/answers";
import { interpretStatementScripted } from "../domain/interpret";
import type { AskedQuestion, OpenQuestion, Statement, WorkflowStage } from "../domain/schemas";
import type { StoredAnalysis } from "../domain/triage";
import { selectVoiceQuestion } from "../domain/voiceTurn";
import { analyzeCase, type CaseInput, type EvidenceFetchState } from "../domain/workflow";
import { DEMO_BRANCHES, DEMO_RECORDS_AT, DEMO_START, DEMO_TRANSACTIONS, demoBeats, type DemoBeat, type DemoBranch } from "../fixtures/guidedIntakeDemo";
import type { CaseView, ViewActivity, ViewStatement, ViewTransaction } from "./types";

/** What the rules produced right after one customer reply. */
export interface DemoSnapshot {
  ref: string;
  stage: WorkflowStage;
  /** Questions still open after this reply (all audiences), in priority order. */
  open: OpenQuestion[];
  /** The question the backend would issue next on the call, or null. */
  next: OpenQuestion | null;
}

export interface DemoState {
  branch: DemoBranch;
  step: number;
  beats: DemoBeat[];
  view: CaseView;
  snapshots: DemoSnapshot[];
}

const id = <T extends "cases" | "statements" | "transactions" | "activity">(s: string) => s as Id<T>;

function store(analysis: ReturnType<typeof analyzeCase>): StoredAnalysis {
  return { ...analysis, rejectedFindings: analysis.rejectedFindings.map((r) => ({ finding: JSON.stringify(r.finding).slice(0, 600), reasons: r.reasons })) };
}

export function buildDemoState(branch: DemoBranch, step: number): DemoState {
  const beats = demoBeats(branch);
  const at = Math.max(0, Math.min(beats.length - 1, step));
  const caseId = id<"cases">(DEMO_BRANCHES.find((b) => b.id === branch)!.caseId);
  const bankFetch: EvidenceFetchState = { status: "ok", at: DEMO_RECORDS_AT, count: DEMO_TRANSACTIONS.length };

  const statements: Statement[] = [];
  const docs: ViewStatement[] = [];
  const activity: ViewActivity[] = [];
  const snapshots: DemoSnapshot[] = [];
  const askedCounts = new Map<string, number>();
  const input = (): CaseInput => ({ statements, transactions: DEMO_TRANSACTIONS, providerEvidence: [], bankFetch });
  const log = (when: number, actor: string, kind: string, message: string) =>
    activity.push({ _id: id<"activity">(`demo-act-${activity.length + 1}`), _creationTime: when, caseId, at: when, actor, kind, message });

  log(DEMO_START, "demo:script", "case_created", "SYNTHETIC DEMO case (scripted scenario). Not stored in Convex.");
  log(DEMO_RECORDS_AT, "demo:fixture", "bank_records_retrieved", `FIXTURE bank records loaded: ${DEMO_TRANSACTIONS.length} purchase record(s). Not a Nessie call.`);

  // Like the voice webhook: the first reply answers no recorded question; each later reply answers
  // the question the rules issued after the previous one.
  let issued: OpenQuestion | null = null;
  for (const beat of beats.slice(0, at + 1)) {
    if (!beat.statement) continue;
    const ref = `S${statements.length + 1}`;
    const receivedAt = DEMO_START + beat.statement.atSec * 1000;
    const text = beat.statement.text;
    const asked: AskedQuestion | undefined = statements.length > 0 && issued ? { key: issued.key, kind: issued.kind, text: issued.text } : undefined;
    const answer = interpretAnswer(text, asked, asked ? relatedRefFromKey(asked.key) : undefined);
    const interpretation = interpretStatementScripted(text, receivedAt);
    statements.push({ ref, text, channel: "voice", receivedAt, interpretation, ...(asked ? { inResponseTo: asked } : {}), ...(answer ? { answer } : {}) });
    docs.push({
      _id: id<"statements">(`demo-stmt-${ref}`),
      _creationTime: receivedAt,
      caseId,
      ref,
      text,
      channel: "voice",
      receivedAt,
      interpretation,
      interpretationStatus: "done",
      ...(asked ? { inResponseTo: asked } : {}),
      ...(answer ? { answer } : {}),
    });
    if (answer && answer.state !== "unparsed") log(receivedAt, "rules:answer-parser", "answer_read", `${ref} read as ${answer.state} for "${answer.key}" (RULE-BASED, using the question as context).`);

    const analysis = analyzeCase(input());
    const choice = selectVoiceQuestion(analysis.questions, askedCounts);
    issued = choice.question;
    if (issued) askedCounts.set(issued.key, (askedCounts.get(issued.key) ?? 0) + 1);
    snapshots.push({ ref, stage: analysis.stage, open: analysis.questions, next: issued });
  }

  const analysis = store(analyzeCase(input()));
  const transactions: ViewTransaction[] = DEMO_TRANSACTIONS.map((t, i) => ({
    _id: id<"transactions">(`demo-txn-${i + 1}`),
    _creationTime: DEMO_RECORDS_AT,
    caseId,
    retrievedAt: DEMO_RECORDS_AT,
    ...t,
  })).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const view: CaseView = {
    case: {
      _id: caseId,
      _creationTime: DEMO_START,
      title: "Synthetic demo (scripted scenario)",
      synthetic: true,
      customerLabel: "Synthetic demo customer",
      nessieAccountId: null,
      nextStatementNumber: statements.length + 1,
      bankFetch,
      analysis,
      analysisVersion: snapshots.length,
      createdAt: DEMO_START,
      nessieAccountBound: false,
    },
    statements: docs,
    transactions,
    providerEvidence: [],
    history: { transactions: [], providerEvidence: [] },
    activity: activity.sort((a, b) => b.at - a.at),
  };
  return { branch, step: at, beats, view, snapshots };
}
