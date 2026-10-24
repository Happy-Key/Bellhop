"use client";

/**
 * The inspection panel beside the workspace: the record, the timeline, the evidence itself and the
 * conversation, or the detail of whatever is selected. A drawer on narrow screens.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { intakeProgress } from "@/lib/review/intake";
import { DECISION_SHORT } from "@/lib/review/labels";
import type { StoredAnalysis } from "@/lib/domain/triage";
import { BankRecords, IdentityEvidence, Statements } from "./CaseSections";
import { EvidenceTrail } from "./EvidenceTrail";
import { shortTime } from "./format";
import { GuidedIntake } from "./GuidedIntake";
import { Detail } from "./InspectorDetails";
import { Timeline } from "./Timeline";
import { Mark, Pill, Tabs } from "./ui";
import type { CaseView, Payment } from "./types";
import { useWorkspace } from "./WorkspaceContext";

type Tab = "record" | "timeline" | "evidence" | "conversation";

export function Inspector() {
  const { ws, selection, clear, panelOpen, setPanelOpen } = useWorkspace();
  const [tab, setTab] = useState<Tab>("record");
  const progress = intakeProgress(ws.data.statements, ws.analysis);
  const payments = paymentsOf(ws.data, ws.analysis);
  const tabs = [
    { id: "record", label: "Record", count: ws.history.length + ws.data.reviewActions.length },
    { id: "timeline", label: "Timeline" },
    { id: "evidence", label: "Evidence", count: ws.data.statements.length + ws.data.transactions.length + ws.data.providerEvidence.length },
    { id: "conversation", label: "Conversation", count: progress.turns.length },
  ];
  return (
    <aside className="cw-side" id="case-inspector" aria-label="Inspector" data-open={panelOpen || undefined}>
      <div className="ins">
        {selection ? (
          <div className="ins-detail" role="region" aria-label="Selected item">
            <div className="ins-detail-bar">
              <button type="button" className="btn btn-sm btn-quiet" onClick={clear}>
                ← Record
              </button>
              <button type="button" className="btn btn-sm btn-quiet ins-close" aria-label="Close details" onClick={() => setPanelOpen(false)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <Detail selection={selection} />
          </div>
        ) : (
          <>
            <div className="ins-bar">
              <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as Tab)} label="Inspector" idPrefix="ins" />
              <button type="button" className="btn btn-sm btn-quiet ins-close" aria-label="Close details" onClick={() => setPanelOpen(false)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div role="tabpanel" id={`ins-panel-${tab}`} aria-labelledby={`ins-tab-${tab}`} className={tab === "record" ? undefined : "ins-body"}>
              {tab === "record" && <RecordTab />}
              {tab === "timeline" && <Timeline data={ws.data} recordSource={ws.mode === "demo" ? "Fixture" : "Nessie"} />}
              {tab === "evidence" && (
                <div className="ins-evidence">
                  <EvidenceTrail analysis={ws.analysis} payment={payments[0] ?? null} paymentCount={payments.length} />
                  <Statements data={ws.data} analysis={ws.analysis} />
                  <BankRecords data={ws.data} analysis={ws.analysis} focusedRef={payments[0]?.ref ?? null} />
                  <IdentityEvidence data={ws.data} />
                </div>
              )}
              {tab === "conversation" && <GuidedIntake progress={progress} />}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

/** Every assessment and every reviewer action, newest first. */
function RecordTab() {
  const { ws, select, isSelected } = useWorkspace();
  type Entry = { at: number; kind: "assessment"; id: string } | { at: number; kind: "action"; id: string };
  const rows: Entry[] = [
    ...ws.history.map((h) => ({ at: h.completedAt, kind: "assessment" as const, id: h._id })),
    ...ws.data.reviewActions.map((a) => ({ at: a.at, kind: "action" as const, id: a._id })),
  ].sort((a, b) => b.at - a.at);
  if (rows.length === 0) return <p className="muted ins-pad">Nothing yet.</p>;
  return (
    <ol className="ins-record">
      {rows.map((r) => {
        if (r.kind === "assessment") {
          const h = ws.history.find((x) => x._id === r.id)!;
          const sel = { kind: "assessment" as const, id: h._id };
          return (
            <li key={`a-${h._id}`}>
              <button type="button" className="row-main" aria-pressed={isSelected(sel)} onClick={() => select(sel)}>
                <Mark kind="model" labelled={false} />
                <span className="row-text">
                  <span>
                    {h.status === "done" ? (h.decision ? `Proposed: ${DECISION_SHORT[h.decision as keyof typeof DECISION_SHORT] ?? h.decision}` : "Assessment") : h.status === "pending" ? "Reassessing" : h.status === "failed" ? "Model call failed" : "Rejected by validation"}{" "}
                    {h.current && h.status === "done" && <Pill tone="accent">current</Pill>}
                    {h.resolution && <Pill tone={h.resolution.accepted ? "ok" : "quiet"}>{h.resolution.accepted ? "authorized" : "rejected"}</Pill>}
                  </span>
                  <span className="row-note">
                    {shortTime(h.completedAt)}
                    {h.changeLog.length ? ` · ${h.changeLog.length} change${h.changeLog.length === 1 ? "" : "s"}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        }
        const a = ws.data.reviewActions.find((x) => x._id === r.id)!;
        const sel = { kind: "action" as const, id: a._id };
        return (
          <li key={`r-${a._id}`}>
            <button type="button" className="row-main" aria-pressed={isSelected(sel)} onClick={() => select(sel)}>
              <Mark kind="person" labelled={false} />
              <span className="row-text">
                <span>{a.kind === "override" ? `Decided differently: ${a.decision ? DECISION_SHORT[a.decision] : ""}` : a.kind === "return" ? "Returned to the investigator" : "Note"}</span>
                <span className="row-note">
                  {shortTime(a.at)} · “{a.reason}”
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The matched record, else the matcher's candidates, in the matcher's order. */
export function paymentsOf(data: CaseView, analysis: StoredAnalysis | null): Payment[] {
  if (!analysis) return [];
  const byRef = new Map(data.transactions.map((t) => [t.ref, t]));
  const refs = analysis.match.matchedRef ? [analysis.match.matchedRef] : analysis.match.candidates.map((c) => c.txnRef);
  return refs.flatMap((ref) => {
    const t = byRef.get(ref);
    if (!t) return [];
    return [{ ref, amount: t.amount, date: t.date, merchant: t.merchantName ?? t.description, status: t.status, matched: ref === analysis.match.matchedRef, candidate: analysis.match.candidates.find((c) => c.txnRef === ref) ?? null }];
  });
}
