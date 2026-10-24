"use client";

/**
 * Claims queue: cases grouped by who needs to act. Selection lives in the URL (?case=<id>) so a
 * presentation can deep-link to a selected case. Keyboard: ↑/↓/Home/End move the selection,
 * Enter opens the case review.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { DECISION_LABEL, type CaseAttention } from "@/lib/review/caseStatus";
import { caseRef, exactTime, relativeTime, usd } from "./format";
import { AttentionGlyph } from "./Tags";

type QueueCase = FunctionReturnType<typeof api.review.queue>[number];
type Filter = "all" | CaseAttention;

const GROUPS: { id: CaseAttention; label: string; hint: string }[] = [
  { id: "reviewer", label: "Needs a bank reviewer", hint: "Authorize, confirm, review or unblock" },
  { id: "customer", label: "Waiting on the customer", hint: "The investigation needs the customer's answer" },
  { id: "system", label: "Investigating", hint: "The reasoning model is working; nobody needs to act" },
  { id: "no_report", label: "No report yet", hint: "Case opened, nothing recorded" },
  { id: "decided", label: "Decided", hint: "An authorized outcome is recorded" },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reviewer", label: "Reviewer" },
  { id: "customer", label: "Customer" },
  { id: "system", label: "Investigating" },
  { id: "decided", label: "Decided" },
];

const WORK_STATE: Record<string, string> = { in_progress: "in progress", awaiting_customer: "awaiting the customer", awaiting_bank: "awaiting the bank" };

const lastTouched = (c: QueueCase) => c.lastActivity?.at ?? c.createdAt;

export function paymentSummary(c: QueueCase): { text: string; note: string } {
  if (c.matched) return { text: `${usd(c.matched.amount)} · ${c.matched.merchant ?? "Unknown merchant"}`, note: "matched to bank record" };
  const r = c.reported;
  const reported = [r.amount !== null ? usd(r.amount) : null, r.merchant].filter(Boolean).join(" · ");
  if (c.candidateCount > 1) return { text: reported || `${c.candidateCount} possible payments`, note: `${c.candidateCount} possible bank records` };
  if (reported) return { text: reported, note: c.bankFetchStatus === "ok" ? "reported, not matched" : "reported, records not retrieved" };
  return { text: "No payment details yet", note: "" };
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function ClaimsQueue() {
  const cases = useQuery(api.review.queue);
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("case");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  const visible = useMemo(() => {
    if (!cases) return [];
    const term = search.trim().toLowerCase();
    return cases
      .filter((c) => filter === "all" || c.status.attention === filter)
      .filter((c) => {
        if (!term) return true;
        const p = paymentSummary(c);
        return [caseRef(c._id), p.text, c.matched?.ref ?? "", c.status.headline, ...c.status.work.map((w) => w.title)].some((s) => s.toLowerCase().includes(term));
      })
      .sort((a, b) => GROUPS.findIndex((g) => g.id === a.triage.attention) - GROUPS.findIndex((g) => g.id === b.triage.attention) || lastTouched(b) - lastTouched(a));
  }, [cases, filter, search]);

  const selected = visible.find((c) => c._id === selectedId) ?? null;

  const select = (id: string) => router.replace(`/review?case=${id}`, { scroll: false });
  const open = (id: string) => router.push(`/review/${id}`);

  // Keep the selected option in view when it changes by keyboard.
  useEffect(() => {
    if (selectedId) document.getElementById(`q-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function onKeyDown(e: KeyboardEvent) {
    if (visible.length === 0) return;
    const i = visible.findIndex((c) => c._id === selectedId);
    const to = (n: number) => {
      e.preventDefault();
      select(visible[Math.max(0, Math.min(visible.length - 1, n))]!._id);
    };
    if (e.key === "ArrowDown") to(i < 0 ? 0 : i + 1);
    else if (e.key === "ArrowUp") to(i < 0 ? 0 : i - 1);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(visible.length - 1);
    else if (e.key === "Enter" && selected) {
      e.preventDefault();
      open(selected._id);
    }
  }

  if (cases === undefined) return <QueueSkeleton />;

  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, cases.filter((c) => c.status.attention === g.id).length])) as Record<CaseAttention, number>;

  return (
    <main className="ws-main ws-queue-page">
      <div className="ws-pagehead">
        <div>
          <h1>Claims queue</h1>
          <p className="ws-summary">
            {cases.length === 0 ? (
              "No cases yet."
            ) : (
              <>
                {cases.length} {cases.length === 1 ? "case" : "cases"}. Needs a reviewer: <strong>{counts.reviewer}</strong> · waiting on the customer:{" "}
                <strong>{counts.customer}</strong> · investigating: <strong>{counts.system}</strong> · decided: <strong>{counts.decided}</strong>.
              </>
            )}{" "}
            <span className="ws-muted">Live from Convex. Synthetic data.</span>
          </p>
        </div>
        <Link href="/review/demo" className="ws-demo-link">
          <span className="ws-demo-tag">Synthetic demo</span> Product demo →
          <span className="ws-small ws-muted">Scripted replay, separate from these cases</span>
        </Link>
      </div>

      <div className="ws-toolbar" role="search">
        <label className="ws-search">
          <span className="ws-visually-hidden">Search cases</span>
          <input type="search" placeholder="Search reference, merchant, amount, next step…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="ws-segmented" role="group" aria-label="Filter by who needs to act">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== "all" && <span className="ws-count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      {cases.length === 0 ? (
        <div className="ws-empty">
          <p><strong>No claims have been reported.</strong></p>
          <p className="ws-muted">
            Cases appear here when a customer calls the <Link href="/call">customer line</Link> or a case is created in the <Link href="/">developer console</Link>.
          </p>
        </div>
      ) : (
        <div className="ws-queue">
          <div
            ref={listRef}
            className="ws-list"
            role="listbox"
            tabIndex={0}
            aria-label="Cases"
            aria-activedescendant={selected ? `q-${selected._id}` : undefined}
            onKeyDown={onKeyDown}
          >
            {visible.length === 0 && <p className="ws-muted ws-pad">No cases match this search or filter.</p>}
            {GROUPS.map((g) => {
              const rows = visible.filter((c) => c.status.attention === g.id);
              if (rows.length === 0) return null;
              return (
                <div key={g.id} role="group" aria-labelledby={`grp-${g.id}`} className="ws-group">
                  <div className="ws-group-head" id={`grp-${g.id}`}>
                    <AttentionGlyph attention={g.id} />
                    {g.label} <span className="ws-count">{rows.length}</span>
                    <span className="ws-muted"> · {g.hint}</span>
                  </div>
                  {rows.map((c) => (
                    <QueueRow
                      key={c._id}
                      c={c}
                      now={now}
                      selected={c._id === selected?._id}
                      onSelect={() => {
                        if (window.matchMedia("(max-width: 900px)").matches) open(c._id);
                        else select(c._id);
                        listRef.current?.focus({ preventScroll: true });
                      }}
                      onOpen={() => open(c._id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          <aside className="ws-preview" aria-label="Selected case">
            {selected ? <Preview c={selected} /> : <p className="ws-muted ws-pad">Select a case to preview it. Use ↑ ↓ to move and Enter to open.</p>}
          </aside>
        </div>
      )}
    </main>
  );
}

function QueueRow({ c, now, selected, onSelect, onOpen }: { c: QueueCase; now: number; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const p = paymentSummary(c);
  const active = c.status.work.find((w) => w.status !== "done" && w.status !== "not_needed");
  const done = c.status.work.filter((w) => w.status === "done").length;
  return (
    <div id={`q-${c._id}`} role="option" aria-selected={selected} className="ws-row" onClick={onSelect} onDoubleClick={onOpen}>
      <div className="ws-row-main">
        <span className="ws-row-ref">{caseRef(c._id)}</span>
        <span className="ws-row-payment">{p.text}</span>
        {p.note && <span className="ws-row-note">{p.note}</span>}
      </div>
      <div className="ws-row-next">{c.status.headline}</div>
      <div className="ws-row-meta">
        {active && <span>{active.title} · {WORK_STATE[active.status] ?? active.status}</span>}
        {c.status.work.length > 0 && <span>{done}/{c.status.work.length} work done</span>}
        {c.status.disposition && !c.status.outcome && <span className="ws-tag ws-tag-live">Proposed: {DECISION_LABEL[c.status.disposition.decision].toLowerCase()}{c.status.disposition.amount !== null ? ` ${usd(c.status.disposition.amount)}` : ""}</span>}
        {c.status.blockers.length > 0 && <span className="ws-block"><span aria-hidden="true">■</span> {c.status.blockers.length} blocking</span>}
        <span title={c.lastActivity ? exactTime(c.lastActivity.at) : undefined}>{relativeTime(lastTouched(c), now)}</span>
      </div>
    </div>
  );
}

function Preview({ c }: { c: QueueCase }) {
  const p = paymentSummary(c);
  const s = c.status;
  const active = s.work.filter((w) => w.status !== "done" && w.status !== "not_needed");
  const done = s.work.filter((w) => w.status === "done");
  return (
    <div className="ws-preview-body">
      <div className="ws-preview-head">
        <h2>{caseRef(c._id)}</h2>
        <span className="ws-stage">{s.statusLabel}</span>
      </div>
      {s.summary && <p className="ws-preview-summary">{s.summary}</p>}
      <dl className="ws-facts">
        <dt>Payment</dt>
        <dd>{p.text}{p.note && <span className="ws-muted"> · {p.note}</span>}</dd>
        <dt>Next</dt>
        <dd><strong>{s.headline}</strong></dd>
        {s.disposition && (
          <>
            <dt>Proposed</dt>
            <dd>{DECISION_LABEL[s.disposition.decision]}{s.disposition.amount !== null ? ` · ${usd(s.disposition.amount)}` : ""}{s.disposition.awaitingPerson && <span className="ws-muted"> · needs a person</span>}</dd>
          </>
        )}
        {s.outcome && (
          <>
            <dt>Outcome</dt>
            <dd>{s.outcome.label}{s.outcome.needsReview && <span className="ws-warn-text"> · needs review: {s.outcome.needsReview}</span>}</dd>
          </>
        )}
        {s.blockers.length > 0 && (
          <>
            <dt>Blocking</dt>
            <dd>{s.blockers.join(" · ")}</dd>
          </>
        )}
        <dt>Report received</dt>
        <dd>{c.reportedAt ? exactTime(c.reportedAt) : <span className="ws-muted">No statement yet (case opened {exactTime(c.createdAt)})</span>}</dd>
      </dl>
      <h3 className="ws-h3">Investigation <span className="ws-tag">{s.source === "model" ? "model" : "rule-based"}</span></h3>
      {s.work.length === 0 ? (
        <p className="ws-muted">No investigative work yet.</p>
      ) : (
        <ol className="ws-steps-mini">
          {active.map((w) => <li key={w.key}><span className="ws-clamp-2"><strong>{w.title}</strong> · {WORK_STATE[w.status] ?? w.status}</span></li>)}
          {done.map((w) => <li key={w.key} className="ws-muted"><span className="ws-clamp-2">✓ {w.doneTitle ?? w.title}</span></li>)}
        </ol>
      )}
      <p className="ws-small ws-muted">{s.findingCount} finding{s.findingCount === 1 ? "" : "s"} · {s.uncertaintyCount} open point{s.uncertaintyCount === 1 ? "" : "s"}</p>
      <Link className="ws-btn ws-btn-primary" href={`/review/${c._id}`}>Open case →</Link>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <main className="ws-main ws-queue-page" aria-busy="true">
      <div className="ws-pagehead"><h1>Claims queue</h1><p className="ws-summary ws-muted">Loading cases…</p></div>
      <div className="ws-queue">
        <div className="ws-list">{[0, 1, 2, 3].map((i) => <div key={i} className="ws-row ws-skel" />)}</div>
        <aside className="ws-preview" />
      </div>
    </main>
  );
}
