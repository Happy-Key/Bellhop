"use client";

import Link from "next/link";

/** Backend failures are shown as they are; no sample data is substituted. */
export default function ReviewError({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  const notDeployed = /Could not find public function/i.test(message);
  const badLink = /ArgumentValidationError/.test(message) && /caseId/.test(message);
  return (
    <main className="ws-main">
      <div className="ws-empty ws-error-box" role="alert">
        <p><strong>{badLink ? "That link doesn't point to a case." : "The workstation couldn't load case data."}</strong></p>
        {badLink ? (
          <p>
            Check the case reference, or go back to the <Link href="/review">claims queue</Link>.
          </p>
        ) : notDeployed ? (
          <p>
            This Convex deployment doesn&apos;t have the workstation queries yet. Push the current functions with <code>npx convex dev</code>, then try again.
          </p>
        ) : (
          <p className="ws-muted">No sample data has been substituted.</p>
        )}
        <pre className="ws-pre">{message}</pre>
        <p>
          <button type="button" className="ws-btn" onClick={retry}>Try again</button> <Link href="/">Developer console</Link>
        </p>
      </div>
    </main>
  );
}
