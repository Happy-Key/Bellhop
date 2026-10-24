"use client";

/**
 * Customer view: only the voice call. A new report opens a new synthetic case on every call (live
 * 2026-10-24: reusing it for "Call again" put rehearsals on a case that was already complete);
 * "An existing case" continues one, and the case just used is pre-selected there.
 * Apart from the demo case list below, nothing here reads case data; the bank dashboard is at "/".
 *
 * DEMO ONLY: a picker chooses a SYNTHETIC demo persona (lib/fixtures/demoPersonas.ts) whose case
 * sets itself up with known bank records and CRS results, so a scripted call has a known outcome.
 * With no persona, the case is a plain synthetic one with no automatic setup.
 * The call can instead continue an EXISTING case (DEMO ONLY: any case can be picked, since there are
 * no customer logins), so the customer can call back with more information after a review.
 */
import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VoiceCall } from "@/components/VoiceCall";
import { DEMO_PERSONAS, getDemoPersona } from "@/lib/fixtures/demoPersonas";

export default function CustomerCallPage() {
  const createPlain = useMutation(api.cases.createSynthetic);
  const createForPersona = useMutation(api.personas.createForPersona);
  const cases = useQuery(api.cases.list);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState<Id<"cases"> | null>(null);
  const [inCall, setInCall] = useState(false);
  const persona = getDemoPersona(personaId);
  // A case deleted from the developer tab drops out of the list, and out of the selection.
  const existing = cases?.find((c) => c._id === existingId) ?? null;

  const chooseExisting = (id: string) => setExistingId(id ? (id as Id<"cases">) : null);

  /** Runs once per call start. */
  const resolveCase = async () => {
    if (mode === "existing") {
      // The button is disabled until a case is chosen; this guards a stale click.
      if (!existing) throw new Error("Choose a case to call back about.");
      return existing._id;
    }
    const id = await (personaId ? createForPersona({ personaId }) : createPlain({}));
    setExistingId(id); // ready under "An existing case" for a call back
    return id;
  };

  const onInCallChange = useCallback((v: boolean) => setInCall(v), []);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center" }}>Report a suspicious transaction</h1>
      <p className="muted" style={{ textAlign: "center" }}>
        Talk to our assistant about a payment you don&apos;t recognize. It will ask a few questions and pass your report to our
        fraud team for review. It cannot move money or approve refunds.
      </p>

      <section className="persona-picker" aria-label="Demo persona">
        <p className="persona-heading">
          <span className="label synthetic">DEMO ONLY</span> This call is about{inCall ? " (locked during the call)" : ""}
        </p>
        <div className="persona-options persona-modes" role="radiogroup" aria-label="New report or existing case">
          {(
            [
              ["new", "A new report", "Opens a new case"],
              ["existing", "An existing case", "Call back with more information"],
            ] as const
          ).map(([m, title, sub]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`persona-option${mode === m ? " persona-selected" : ""}`} disabled={inCall} onClick={() => setMode(m)}>
              <strong>{title}</strong>
              <span>{sub}</span>
            </button>
          ))}
        </div>
        {mode === "existing" ? (
          <div className="callback-picker">
            <label>
              Case{" "}
              <select value={existing?._id ?? ""} disabled={inCall || cases === undefined} onChange={(e) => chooseExisting(e.target.value)}>
                <option value="">{cases === undefined ? "Loading…" : cases.length === 0 ? "No cases yet" : "Choose a case…"}</option>
                {cases?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {getDemoPersona(c.demoPersonaId)?.name ?? "No persona"} · {new Date(c.createdAt).toLocaleString()} · {c.stage.replace(/_/g, " ")}
                    {c.openCustomerQuestions ? ` · ${c.openCustomerQuestions} question(s) waiting` : ""}
                  </option>
                ))}
              </select>
            </label>
            {existing ? (
              <p className="muted">
                {existing.title}. The assistant picks up where the case left off: it asks whatever the bank still needs, and
                anything new the customer says is added to the same case.
              </p>
            ) : (
              <p className="muted">Pick the case the customer is calling back about. The newest cases are listed first.</p>
            )}
          </div>
        ) : (
          <>
            <p className="persona-heading">Call as a synthetic customer</p>
            <div className="persona-options" role="radiogroup" aria-label="Demo persona">
              {[null, ...DEMO_PERSONAS.map((p) => p.id)].map((id) => {
                const p = getDemoPersona(id);
                return (
                  <button
                    key={id ?? "none"}
                    type="button"
                    role="radio"
                    aria-checked={personaId === id}
                    className={`persona-option${personaId === id ? " persona-selected" : ""}`}
                    disabled={inCall}
                    onClick={() => setPersonaId(id)}
                  >
                    <strong>{p ? p.name : "No persona"}</strong>
                    <span>{p ? `${p.home.city}, ${p.home.state} · CRS ${p.crsPersonaId}` : "Plain case, no setup"}</span>
                  </button>
                );
              })}
            </div>
            {persona ? (
              <details className="persona-notes">
                <summary>Presenter notes for {persona.name}</summary>
                <p>{persona.scenario}</p>
                <p>
                  <strong>Expected:</strong> {persona.expectedOutcome}
                </p>
                <p className="muted">
                  Starting the call opens a case that retrieves this persona&apos;s bank records, attaches their payment-origin records
                  and runs the CRS checks on its own. Say the amount and merchant: purchase dates are fixed at the day the personas
                  were seeded.
                </p>
                <table className="persona-ledger">
                  <tbody>
                    {persona.purchases.map((x) => (
                      <tr key={x.key} className={x.key === persona.disputedKey ? "persona-disputed" : undefined}>
                        <td>${x.amount}</td>
                        <td>{x.merchant.replace(/^FCI Demo /, "")}</td>
                        <td>{x.key === persona.disputedKey ? "disputed" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  <strong>Suggested lines</strong> (answer the assistant&apos;s questions in between):
                </p>
                <ol>
                  {persona.script.map((line) => (
                    <li key={line}>&ldquo;{line}&rdquo;</li>
                  ))}
                </ol>
              </details>
            ) : (
              <p className="muted">With no persona, records are retrieved and CRS checks run by hand on the case page.</p>
            )}
          </>
        )}
      </section>

      {mode === "existing" && !existing ? (
        <p className="muted" style={{ textAlign: "center" }}>Choose a case above to start the call.</p>
      ) : (
        <VoiceCall key={mode === "existing" ? existing!._id : "new"} caseId={resolveCase} variant="customer" onInCallChange={onInCallChange} />
      )}
    </main>
  );
}
