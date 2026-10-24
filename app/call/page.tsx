"use client";

/**
 * Customer view: a voice call or, as the typed alternative, a text chat, as the bank's consumer channel
 * would show it. Both go through the same backend turn. A new report opens a new synthetic case on every
 * call or chat; "an existing case" continues one (DEMO ONLY: no customer logins).
 *
 * DEMO ONLY: a presenter panel (closed by default, top right) chooses a SYNTHETIC demo persona
 * (lib/fixtures/demoPersonas.ts) whose case sets itself up with known bank records and CRS results,
 * so a scripted call has a known outcome. With no persona, the case is plain and gets no setup.
 */
import Image from "next/image";
import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TextChat } from "@/components/TextChat";
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
  const [channel, setChannel] = useState<"voice" | "text">("voice");
  const persona = getDemoPersona(personaId);
  // A case deleted from the developer tools drops out of the list, and out of the selection.
  const existing = cases?.find((c) => c._id === existingId) ?? null;

  /** Runs once per call start. */
  const resolveCase = async () => {
    if (mode === "existing") {
      if (!existing) throw new Error("Choose a case to call back about.");
      return existing._id;
    }
    const id = await (personaId ? createForPersona({ personaId }) : createPlain({}));
    setExistingId(id); // ready under "An existing case" for a call back
    return id;
  };

  const onInCallChange = useCallback((v: boolean) => setInCall(v), []);
  const summary = mode === "existing" ? (existing ? `Calling back about ${getDemoPersona(existing.demoPersonaId)?.name ?? existing.title}` : "Calling back: choose a case") : persona ? `Calling as ${persona.name}` : "Calling as a plain synthetic customer";

  return (
    <main className="cl">
      <header className="cl-head">
        <span className="cl-brand">
          <Image src="/bellhop.png" alt="" width={26} height={26} priority />
          Bellhop
        </span>
        <h1 className="cl-title">Demo Bank fraud support</h1>
        <details className="cc-presenter" aria-label="Presenter controls">
          <summary>
            <span>
              {summary}
              {inCall ? " · locked during the call" : ""}
            </span>
          </summary>
          <div className="cc-presenter-body">
            <div className="cc-options" role="radiogroup" aria-label="New report or existing case">
              {(
                [
                  ["new", "A new report", "Opens a new case"],
                  ["existing", "An existing case", "Call back with more information"],
                ] as const
              ).map(([m, title, sub]) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className="cc-option" disabled={inCall} onClick={() => setMode(m)}>
                  <strong>{title}</strong>
                  <span>{sub}</span>
                </button>
              ))}
            </div>
            {mode === "existing" ? (
              <label className="field">
                <span>Case</span>
                <select value={existing?._id ?? ""} disabled={inCall || cases === undefined} onChange={(e) => setExistingId(e.target.value ? (e.target.value as Id<"cases">) : null)}>
                  <option value="">{cases === undefined ? "Loading…" : cases.length === 0 ? "No cases yet" : "Choose a case…"}</option>
                  {cases?.map((c) => (
                    <option key={c._id} value={c._id}>
                      {getDemoPersona(c.demoPersonaId)?.name ?? "No persona"} · {new Date(c.createdAt).toLocaleString()} · {c.stage.replace(/_/g, " ")}
                      {c.openCustomerQuestions ? ` · ${c.openCustomerQuestions} question(s) waiting` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <span className="eyebrow">Persona</span>
                <div className="cc-options" role="radiogroup" aria-label="Demo persona">
                  {[null, ...DEMO_PERSONAS.map((p) => p.id)].map((id) => {
                    const p = getDemoPersona(id);
                    return (
                      <button key={id ?? "none"} type="button" role="radio" aria-checked={personaId === id} className="cc-option" disabled={inCall} onClick={() => setPersonaId(id)}>
                        <strong>{p ? p.name : "No persona"}</strong>
                        <span>{p ? `${p.home.city}, ${p.home.state} · CRS ${p.crsPersonaId}` : "Plain case, no setup"}</span>
                      </button>
                    );
                  })}
                </div>
                {persona ? (
                  <div className="small">
                    <p>
                      <strong>Expected:</strong> {persona.expectedOutcome}
                    </p>
                    <table className="cc-ledger">
                      <tbody>
                        {persona.purchases.map((x) => (
                          <tr key={x.key} data-disputed={x.key === persona.disputedKey || undefined}>
                            <td>${x.amount}</td>
                            <td>{x.merchant.replace(/^FCI Demo /, "")}</td>
                            <td>{x.key === persona.disputedKey ? "disputed" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p>
                      <strong>Lines</strong>
                    </p>
                    <ol className="cc-script">
                      {persona.script.map((line) => (
                        <li key={line}>“{line}”</li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="muted xs">No automatic setup.</p>
                )}
              </>
            )}
          </div>
        </details>
      </header>
      <hr className="cl-rule" />
      <div className="cl-switch" role="radiogroup" aria-label="How to reach us">
        {(
          [
            ["voice", "Call"],
            ["text", "Chat"],
          ] as const
        ).map(([c, label]) => (
          <button key={c} type="button" role="radio" aria-checked={channel === c} disabled={inCall} onClick={() => setChannel(c)}>
            {label}
          </button>
        ))}
      </div>

      {mode === "existing" && !existing ? (
        <p className="cl-choose">Choose a case to start.</p>
      ) : channel === "voice" ? (
        <VoiceCall key={mode === "existing" ? existing!._id : "new"} caseId={resolveCase} variant="customer" onInCallChange={onInCallChange} />
      ) : (
        <TextChat key={mode === "existing" ? existing!._id : "new"} caseId={resolveCase} existingCaseId={mode === "existing" ? existing!._id : null} onInChatChange={onInCallChange} />
      )}
      <p className="cl-foot">Live voice assistant · synthetic account</p>
    </main>
  );
}
