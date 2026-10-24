"use client";

/** The investigation as it stands: current work, blockers, the next question, completed work. */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { WorkItem } from "@/lib/domain/investigation";
import { WORK_STATUS_LABEL } from "@/lib/review/labels";
import { RefChips } from "./EvidenceRef";
import { SourceTag } from "./FindingsPanel";
import { Mark, Row, errorText } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

function WorkRow({ w }: { w: WorkItem }) {
  const { select, isSelected } = useWorkspace();
  const sel = { kind: "work" as const, key: w.key };
  const done = w.status === "done";
  return (
    <Row status={w.status} selected={isSelected(sel)} onSelect={() => select(sel)} lead={<span className="work-mark" aria-hidden="true" />} chips={<RefChips refs={w.refs} />}>
      <span className="work-title">
        {done ? (w.doneTitle ?? w.title) : w.title}
        <span className={`work-state work-state-${w.status}`}>{WORK_STATUS_LABEL[w.status]}</span>
      </span>
      <span className="row-note">{done ? (w.outcome ?? w.detail) : w.detail}</span>
    </Row>
  );
}

export function WorkPanel() {
  const { ws, select, isSelected } = useWorkspace();
  const { status, mode, modelEnabled, reassessing, problem, data } = ws;
  const active = status.work.filter((w) => w.status !== "done" && w.status !== "not_needed");
  const done = status.work.filter((w) => w.status === "done");
  return (
    <section className="card" aria-labelledby="work-h">
      <div className="card-head">
        <h2 id="work-h">Investigation</h2>
        <span>
          {reassessing && (
            <span className="tag tag-live pulse" role="status">
              Reassessing
            </span>
          )}{" "}
          <SourceTag />
        </span>
      </div>
      {problem && (
        <p className="small error" role="status">
          Latest assessment not used: {problem}
        </p>
      )}
      {status.returned && (
        <p className="small muted">
          <Mark kind="person" labelled={false} /> Returned: “{status.returned.reason}”
        </p>
      )}
      <div className="two">
        <div>
          <h3>
            Current <span className="count">{active.length}</span>
          </h3>
          {active.length === 0 ? (
            <p className="muted">{status.work.length === 0 ? "None yet." : "Nothing in progress."}</p>
          ) : (
            <ul className="rows">
              {active.map((w) => (
                <WorkRow key={w.key} w={w} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="done-list">
              <summary>
                Completed <span className="count">{done.length}</span>
              </summary>
              <ul className="rows">
                {done.map((w) => (
                  <WorkRow key={w.key} w={w} />
                ))}
              </ul>
            </details>
          )}
        </div>
        <div>
          {status.blockers.length > 0 && (
            <>
              <h3>Blocking</h3>
              <ul className="blockers">
                {status.blockers.map((b) => (
                  <li key={b}>
                    <Mark kind="blocking" labelled={false} className="mark-crit" /> {b}
                  </li>
                ))}
              </ul>
            </>
          )}
          {status.nextQuestion && (
            <>
              <h3 className={status.blockers.length ? "mt" : undefined}>Next question</h3>
              <ul className="rows">
                <Row selected={isSelected({ kind: "question" })} onSelect={() => select({ kind: "question" })} lead={<Mark kind="customer" />}>
                  “{status.nextQuestion}”
                </Row>
              </ul>
            </>
          )}
          {status.blockers.length === 0 && !status.nextQuestion && <p className="muted">Nothing blocking.</p>}
          {mode === "live" && modelEnabled && data.statements.length > 0 && <Reassess reassessing={reassessing} />}
        </div>
      </div>
    </section>
  );
}

function Reassess({ reassessing }: { reassessing: boolean }) {
  const { ws } = useWorkspace();
  const ask = useMutation(api.proposals.requestProposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <p className="mt">
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy || reassessing}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await ask({ caseId: ws.data.case._id });
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {reassessing ? "Reassessing…" : busy ? "Asking…" : "Reassess"}
      </button>
      {error && (
        <span className="error small" role="status">
          {" "}
          {error}
        </span>
      )}
    </p>
  );
}
