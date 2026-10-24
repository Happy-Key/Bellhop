"use client";

/** Prepared documents (previewed in the inspector) and the actions that follow, with their execution state. */
import { FileText } from "lucide-react";
import { DOC_AUDIENCE, DOC_LABEL } from "@/lib/review/labels";
import { usd } from "./format";
import { Pill, Row, type Tone } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

interface FollowUp {
  label: string;
  state: "executed" | "pending" | "failed" | "on_authorization" | "not_executed" | "applied";
}

const STATE: Record<FollowUp["state"], { text: string; tone: Tone }> = {
  executed: { text: "Executed", tone: "ok" },
  pending: { text: "Pending", tone: "warn" },
  failed: { text: "Failed", tone: "crit" },
  on_authorization: { text: "After authorization", tone: "quiet" },
  not_executed: { text: "Not sent", tone: "quiet" },
  applied: { text: "Applied", tone: "accent" },
};

export function OutputsPanel() {
  const { ws, select, isSelected } = useWorkspace();
  const { proposal, status, data, accepted } = ws;
  const docs = proposal?.documents ?? [];
  const stale = !!accepted && !accepted.current;
  const decision = data.decisions[0] ?? null;
  const d = status.disposition;
  const o = status.outcome;

  const follow: FollowUp[] = [];
  if (decision) {
    const s = decision.payout.status;
    follow.push({ label: `Simulated payout of ${usd(decision.amount)}`, state: s === "deposited" ? "executed" : s === "failed" ? "failed" : "pending" });
    if (docs.some((x) => x.kind === "customer_letter")) follow.push({ label: "Customer letter", state: "not_executed" });
  } else if (d?.decision === "approve") {
    follow.push({ label: `Simulated payout${d.amount !== null ? ` of ${usd(d.amount)}` : ""}`, state: "on_authorization" });
  } else if (d?.decision === "deny" || o?.kind === "denied") {
    follow.push({ label: "Written explanation to the customer", state: o?.kind === "denied" ? "not_executed" : "on_authorization" });
  } else if (d?.decision === "escalate") {
    follow.push({ label: "Routed to the specialist queue", state: "applied" });
  }
  if (status.nextQuestion) follow.push({ label: "Question asked on the next call", state: "applied" });

  if (docs.length === 0 && follow.length === 0) return null;
  return (
    <section className="card" aria-labelledby="outputs-h">
      <div className="card-head">
        <h2 id="outputs-h">Outputs</h2>
      </div>
      <div className="two">
        <div>
          <h3>
            Documents <span className="count">{docs.length}</span>
          </h3>
          {docs.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="rows">
              {docs.map((doc, index) => {
                const sel = { kind: "document" as const, index };
                return (
                  <Row key={index} selected={isSelected(sel)} onSelect={() => select(sel)} lead={<FileText size={14} aria-hidden="true" className="row-icon" />} chips={stale ? <Pill tone="warn">Needs reassessment</Pill> : undefined}>
                    <span>
                      <strong>{DOC_LABEL[doc.kind]}</strong>
                      <span className="muted"> · {DOC_AUDIENCE[doc.kind]}</span>
                    </span>
                    <span className="row-note">{doc.text}</span>
                  </Row>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3>Follow-up</h3>
          {follow.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="rows">
              {follow.map((f) => (
                <Row key={f.label} lead={<Pill tone={STATE[f.state].tone}>{STATE[f.state].text}</Pill>}>
                  {f.label}
                </Row>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
