"use client";

/**
 * Customer view: only the voice call. Each visit opens one synthetic case, created when the first
 * call starts and reused for "Call again", so the bank sees the whole conversation on one case.
 * Nothing here reads case data; the bank dashboard is at "/".
 *
 * DEMO ONLY: a picker chooses a SYNTHETIC demo persona (lib/fixtures/demoPersonas.ts) whose case
 * sets itself up with known bank records and CRS results, so a scripted call has a known outcome.
 * With no persona, the case is a plain synthetic one with no automatic setup.
 */
import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { VoiceCall } from "@/components/VoiceCall";
import { DEMO_PERSONAS, getDemoPersona } from "@/lib/fixtures/demoPersonas";

export default function CustomerCallPage() {
  const createPlain = useMutation(api.cases.createSynthetic);
  const createForPersona = useMutation(api.personas.createForPersona);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [inCall, setInCall] = useState(false);
  const caseId = useRef<Promise<Id<"cases">> | null>(null);
  const persona = getDemoPersona(personaId);

  const choosePersona = (id: string | null) => {
    if (id === personaId) return;
    setPersonaId(id);
    caseId.current = null; // a different customer gets a new case on the next call
  };

  const resolveCase = () => {
    caseId.current ??= (personaId ? createForPersona({ personaId }) : createPlain({})).catch((e: unknown) => {
      caseId.current = null; // let the next attempt retry
      throw e;
    });
    return caseId.current;
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
          <span className="label synthetic">DEMO ONLY</span> Call as a synthetic customer{inCall ? " (locked during the call)" : ""}
        </p>
        <div className="persona-options" role="radiogroup">
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
                onClick={() => choosePersona(id)}
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
      </section>

      <VoiceCall caseId={resolveCase} variant="customer" onInCallChange={onInCallChange} />
    </main>
  );
}
