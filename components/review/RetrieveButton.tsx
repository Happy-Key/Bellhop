"use client";

/** Bank record retrieval for a case: a live, read-only Nessie call through Convex. */
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspaceMode } from "./WorkspaceMode";

/** Live, read-only Nessie retrieval through Convex. Failures are recorded and shown, never replaced. */
export function RetrieveButton(props: { caseId: Id<"cases">; again: boolean; primary?: boolean }) {
  if (useWorkspaceMode() === "demo") return <span className="ws-action ws-small ws-muted">Retrieval isn&apos;t available in the demo; its records are fixtures.</span>;
  return <LiveRetrieveButton {...props} />;
}

function LiveRetrieveButton({ caseId, again, primary }: { caseId: Id<"cases">; again: boolean; primary?: boolean }) {
  const retrieve = useAction(api.nessie.retrieveBankEvidence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ws-action">
      <button
        type="button"
        className={`ws-btn${primary ? " ws-btn-primary" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await retrieve({ caseId });
            if (!r.ok) setError(r.error ?? "Retrieval failed");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Retrieving…" : again ? "Retrieve bank records again" : "Retrieve bank records"}
      </button>
      <span className="ws-small ws-muted"> live Nessie call</span>
      {error && <span className="ws-small ws-error-text" role="status"> {error}</span>}
    </span>
  );
}
