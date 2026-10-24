"use client";

/**
 * Shared case state for the workspace: the live view, the analysis, the status view model, the
 * model's accepted proposal, policy evaluation and assessment history, plus the inspector selection.
 * Every panel reads from here, so summaries, findings, rules, work, documents and the inspector
 * always describe the same case state. In demo mode the same shape is built from the scripted
 * fixture, and reviewer actions go to `onDemoAction` (local state) instead of Convex.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { AutoApprovalEvaluation } from "@/lib/domain/autoApproval";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import type { StoredAnalysis } from "@/lib/domain/triage";
import type { CaseStatus, ReviewActionRow } from "@/lib/review/caseStatus";
import { sameSelection, type Selection } from "@/lib/review/inspector";
import type { CaseView } from "@/lib/review/types";

export type WorkspaceMode = "live" | "demo";

export interface HistoryRow {
  _id: string;
  status: "pending" | "done" | "rejected_by_validation" | "failed";
  trigger: "auto" | "manual";
  requestedAt: number;
  completedAt: number;
  provider: string | null;
  decision: string | null;
  changeLog: { kind: string; text: string }[];
  resolution: { accepted: boolean; note: string; at: number } | null;
  problems: string[];
  error: string | null;
  current: boolean;
}

/** A question a reviewer put to the customer (convex/reviewerQuestions.ts). */
export interface ReviewerQuestionRow {
  _id: Id<"reviewerQuestions">;
  text: string;
  askedAt: number;
  answeredByRef?: string;
  answeredAt?: number;
  withdrawnAt?: number;
}

export interface Workspace {
  mode: WorkspaceMode;
  data: CaseView;
  analysis: StoredAnalysis | null;
  status: CaseStatus;
  proposal: CaseProposal | null;
  /** The accepted proposal predates the investigation format (its work is the rule-based fallback). */
  legacy: boolean;
  auto: AutoApprovalEvaluation | null;
  accepted: { id: Id<"caseProposals"> | null; current: boolean } | null;
  history: HistoryRow[];
  reassessing: boolean;
  problem: string | null;
  modelEnabled: boolean;
  /** Questions reviewers put to the customer, newest first; asked first on the next call or chat. */
  asked: ReviewerQuestionRow[];
}

/** What a reviewer control asks to record. In live mode these map to Convex mutations; in demo mode to local state. */
export type DemoAction = { kind: "override"; decision: ReviewActionRow["decision"]; reason: string; question?: string } | { kind: "return"; request: string };

interface Ctx {
  ws: Workspace;
  selection: Selection | null;
  /** Selecting the selected item again clears it. */
  select: (s: Selection) => void;
  clear: () => void;
  isSelected: (s: Selection) => boolean;
  /** Narrow screens: the inspector is a drawer. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Demo mode only: where reviewer actions go instead of Convex. */
  onDemoAction: ((a: DemoAction) => void) | null;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ value, onDemoAction = null, children }: { value: Workspace; onDemoAction?: ((a: DemoAction) => void) | null; children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const select = useCallback((s: Selection) => {
    setSelection((prev) => (sameSelection(prev, s) ? null : s));
    setPanelOpen(true);
  }, []);
  const clear = useCallback(() => setSelection(null), []);
  const isSelected = useCallback((s: Selection) => sameSelection(selection, s), [selection]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      setSelection(null);
      setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const ctx = useMemo<Ctx>(() => ({ ws: value, selection, select, clear, isSelected, panelOpen, setPanelOpen, onDemoAction }), [value, selection, select, clear, isSelected, panelOpen, onDemoAction]);
  return <WorkspaceCtx.Provider value={ctx}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("useWorkspace outside WorkspaceProvider");
  return c;
}

export const useWorkspaceOptional = () => useContext(WorkspaceCtx);

/** "live" or "demo"; "live" when used outside a workspace. Live-only actions (retrieval, payouts) check this. */
export const useWorkspaceMode = (): WorkspaceMode => useContext(WorkspaceCtx)?.ws.mode ?? "live";
