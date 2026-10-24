"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { IntegrationStatus } from "@/components/IntegrationStatus";

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
    <main>
      <h1>Cases</h1>
      <button
        onClick={async () => {
          const id = await create({});
          router.push(`/cases/${id}`);
        }}
      >
        Create synthetic claim
      </button>
      <section>
        <h2>Existing cases</h2>
        {removeError && <p className="error">Delete failed: {removeError}</p>}
        {cases === undefined ? (
          <p className="muted">Loading…</p>
        ) : cases.length === 0 ? (
          <p className="muted">No cases yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Case</th><th>Stage</th><th>Created</th><th></th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c._id}>
                  <td><span className="label synthetic">synthetic</span><Link href={`/cases/${c._id}`}>{c.title}</Link></td>
                  <td>{c.stage}</td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                  <td>
                    <button className="danger" disabled={removing === c._id} onClick={() => removeCase(c._id, c.title)}>
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
