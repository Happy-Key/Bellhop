"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { IntegrationStatus } from "@/components/IntegrationStatus";

export default function Home() {
  const cases = useQuery(api.cases.list);
  const create = useMutation(api.cases.createSynthetic);
  const router = useRouter();

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
        {cases === undefined ? (
          <p className="muted">Loading…</p>
        ) : cases.length === 0 ? (
          <p className="muted">No cases yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Case</th><th>Stage</th><th>Created</th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c._id}>
                  <td><span className="label synthetic">synthetic</span><Link href={`/cases/${c._id}`}>{c.title}</Link></td>
                  <td>{c.stage}</td>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
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
