"use client";

/** Developer tools: create and delete synthetic cases, open the per-case controls, see integration configuration. Not a reviewer screen. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { IntegrationStatus } from "@/components/IntegrationStatus";
import { caseRef } from "@/components/review/format";
import { customerName } from "@/lib/review/labels";

export default function Home() {
  const cases = useQuery(api.cases.list);
  const create = useMutation(api.cases.createSynthetic);
  const remove = useMutation(api.cases.remove);
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeCase = async (id: Id<"cases">, title: string) => {
    if (!window.confirm(`Delete "${title}" and everything recorded for it (statements, evidence, activity, decisions, calls)? This can't be undone. Nessie records, including any SIMULATED payout, stay in Nessie.`)) return;
    setRemoving(id);
    setRemoveError(null);
    try {
      await remove({ caseId: id });
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Developer Tools</h1>
          <p className="muted">Synthetic cases and integration configuration. Reviewers work in the claims queue.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            const id = await create({});
            router.push(`/cases/${id}`);
          }}
        >
          Create a synthetic case
        </button>
      </div>
      <section className="dev-section">
        <h2>Cases</h2>
        {removeError && <p className="error small">Delete failed: {removeError}</p>}
        {cases === undefined ? (
          <p className="muted">Loading…</p>
        ) : cases.length === 0 ? (
          <p className="muted">No cases yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Customer</th>
                <th>Stage</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c._id}>
                  <td>
                    <span className="ref">{caseRef(c._id)}</span> <Link href={`/cases/${c._id}`}>Case tools</Link> · <Link href={`/review/${c._id}`}>Workstation</Link>
                  </td>
                  <td>{customerName(c).name}</td>
                  <td>{c.stage.replace(/_/g, " ")}</td>
                  <td className="tnum">{new Date(c.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-danger" disabled={removing === c._id} onClick={() => removeCase(c._id, c.title)}>
                      {removing === c._id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <IntegrationStatus />
    </main>
  );
}
