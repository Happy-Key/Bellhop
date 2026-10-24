"use client";

/** Bank record retrieval for a case: a live, read-only Nessie call through Convex. Failures are recorded and shown, never replaced. */
import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorText } from "./ui";
import { useWorkspaceMode } from "./WorkspaceContext";

export function RetrieveButton(props: { caseId: Id<"cases">; again: boolean; primary?: boolean }) {
  if (useWorkspaceMode() === "demo") return null;
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
        className={`btn btn-sm${primary ? " btn-primary" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await retrieve({ caseId });
            if (!r.ok) setError(r.error ?? "Retrieval failed");
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Retrieving…" : again ? "Retrieve bank records again" : "Retrieve bank records"}
      </button>
      {error && (
        <span className="ws-small ws-error-text" role="status">
          {error}
        </span>
      )}
    </span>
  );
}
