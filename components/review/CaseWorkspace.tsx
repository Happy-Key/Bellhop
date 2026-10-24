"use client";

/**
 * The case workspace: results first in the main column (decision, findings, rules, outputs,
 * investigation), traceability in the inspector beside it. Selecting anything in the main column
 * updates the inspector without moving the reviewer. On narrow screens the inspector is a drawer.
 */
import { HighlightProvider } from "./EvidenceRef";
import { CaseHeader } from "./CaseHeader";
import { DecisionBand } from "./DecisionBand";
import { FindingsPanel } from "./FindingsPanel";
import { FrameworkPanel } from "./FrameworkPanel";
import { Inspector } from "./Inspector";
import { OutputsPanel } from "./OutputsPanel";
import { WorkPanel } from "./WorkPanel";
import { useWorkspace, WorkspaceProvider, type DemoAction, type Workspace } from "./WorkspaceContext";

export function CaseWorkspace({ ws, onDemoAction }: { ws: Workspace; onDemoAction?: (a: DemoAction) => void }) {
  return (
    <WorkspaceProvider value={ws} onDemoAction={onDemoAction ?? null}>
      <HighlightProvider>
        <Layout />
      </HighlightProvider>
    </WorkspaceProvider>
  );
}

function Layout() {
  const { panelOpen } = useWorkspace();
  return (
    <div className="cw" data-panel-open={panelOpen || undefined}>
      <CaseHeader />
      <div className="cw-grid">
        <main className="cw-main" id="case-main">
          <DecisionBand />
          <FindingsPanel />
          <FrameworkPanel />
          <OutputsPanel />
          <WorkPanel />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
