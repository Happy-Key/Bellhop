"use client";

/** What is established and what is still open, from the investigation. Selecting an item opens it in the inspector. */
import { BASIS_LABEL, HYPOTHESIS_LABEL } from "@/lib/review/labels";
import { RefChips } from "./EvidenceRef";
import { Mark, Pill, Row } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export function SourceTag() {
  const { ws } = useWorkspace();
  if (ws.status.source === "model") return null;
  return <span className="tag">Rule-based</span>;
}

export function FindingsPanel() {
  const { ws, select, isSelected } = useWorkspace();
  const inv = ws.status.investigation;
  const findings = inv.findings.map((f, index) => ({ f, index })).sort((a, b) => Number(b.f.basis === "corroborated") - Number(a.f.basis === "corroborated"));
  const open = inv.uncertainties.map((u, index) => ({ u, index })).sort((a, b) => Number(b.u.blocking) - Number(a.u.blocking));
  const hypotheses = inv.hypotheses.map((h, index) => ({ h, index }));
  return (
    <section className="card" aria-labelledby="findings-h">
      <div className="card-head">
        <h2 id="findings-h">Findings</h2>
        <SourceTag />
      </div>
      <div className="two">
        <div>
          <h3>
            Established <span className="count">{findings.length}</span>
          </h3>
          {findings.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="rows">
              {findings.map(({ f, index }) => {
                const sel = { kind: "finding" as const, index };
                return (
                  <Row key={index} selected={isSelected(sel)} onSelect={() => select(sel)} lead={<Mark kind={f.basis === "corroborated" ? "observed" : "reported"} label={BASIS_LABEL[f.basis]} />} chips={<RefChips refs={f.refs} />}>
                    {f.text}
                  </Row>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3>
            Open <span className="count">{open.length}</span>
          </h3>
          {open.length === 0 ? (
            <p className="muted">Nothing open.</p>
          ) : (
            <ul className="rows">
              {open.map(({ u, index }) => {
                const sel = { kind: "uncertainty" as const, index };
                return (
                  <Row key={index} selected={isSelected(sel)} onSelect={() => select(sel)} lead={u.blocking ? <Mark kind="blocking" className="mark-crit" /> : <Mark kind="inferred" label="Open" />}>
                    {u.text}
                  </Row>
                );
              })}
            </ul>
          )}
          {hypotheses.length > 0 && (
            <>
              <h3 className="mt">Interpretations</h3>
              <ul className="rows">
                {hypotheses.map(({ h, index }) => {
                  const sel = { kind: "hypothesis" as const, index };
                  return (
                    <Row key={index} className={h.status === "ruled_out" ? "is-ruled-out" : undefined} selected={isSelected(sel)} onSelect={() => select(sel)} lead={<Pill tone={h.status === "supported" ? "ok" : h.status === "ruled_out" ? "quiet" : "warn"}>{HYPOTHESIS_LABEL[h.status]}</Pill>} chips={<RefChips refs={h.refs} />}>
                      {h.text}
                    </Row>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
