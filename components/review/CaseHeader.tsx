"use client";

/** Case identity: reference, customer, the allegation in one line, the one status pill. */
import Link from "next/link";
import { PanelRight } from "lucide-react";
import type { CaseAttention } from "@/lib/review/caseStatus";
import { customerName } from "@/lib/review/labels";
import { caseRef, exactTime, POSITION_LABEL, usd } from "./format";
import { Pill, type Tone } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export const ATTENTION_TONE: Record<CaseAttention, Tone> = { reviewer: "accent", customer: "warn", system: "neutral", no_report: "quiet", auto_approved: "ok", decided: "ok" };

export function allegationLine(ws: ReturnType<typeof useWorkspace>["ws"]): string {
  const { data, analysis } = ws;
  const first = data.statements[0] ?? null;
  if (!first) return "No report yet";
  const matchedRef = analysis?.match.matchedRef ?? null;
  const matched = matchedRef ? (data.transactions.find((t) => t.ref === matchedRef) ?? null) : null;
  const facts = analysis?.facts;
  const amount = matched?.amount ?? facts?.amounts.at(-1)?.value ?? null;
  const payee = matched?.merchantName ?? matched?.description ?? facts?.merchantTerms.at(-1)?.value ?? null;
  const date = matched?.date ?? facts?.dates.at(-1)?.value ?? null;
  const position = facts?.authorization ? (POSITION_LABEL[facts.authorization.value] ?? null) : null;
  return [
    amount !== null ? `Disputes ${usd(amount)}${payee ? ` at ${payee}` : ""}${date ? ` on ${date}` : ""}${matched ? "" : " (unmatched)"}` : "Payment not yet identified",
    position ? position.charAt(0).toLowerCase() + position.slice(1) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function CaseHeader() {
  const { ws, panelOpen, setPanelOpen } = useWorkspace();
  const { data, status, mode } = ws;
  const who = customerName(data.case);
  const first = data.statements[0] ?? null;
  return (
    <header className="cw-head">
      <div className="cw-head-main">
        <p className="cw-crumbs">
          {mode === "live" ? <Link href={`/review?case=${data.case._id}`}>Claims queue</Link> : <span>Demo</span>}
          <span aria-hidden="true"> / </span>
          <span className="mono">{caseRef(data.case._id)}</span>
        </p>
        <div className="cw-title">
          <h1>{who.name}</h1>
          <Pill tone={ATTENTION_TONE[status.attention]}>{status.statusLabel}</Pill>
        </div>
        <p className="cw-allegation">{allegationLine(ws)}</p>
        <p className="cw-meta muted small">{first ? `Reported ${exactTime(first.receivedAt)} by ${first.channel}` : `Opened ${exactTime(data.case.createdAt)}`}</p>
      </div>
      <div className="cw-head-tools">
        <button type="button" className="btn btn-sm cw-panel-toggle" aria-expanded={panelOpen} aria-controls="case-inspector" onClick={() => setPanelOpen(!panelOpen)}>
          <PanelRight size={14} aria-hidden="true" /> Details
        </button>
      </div>
    </header>
  );
}
