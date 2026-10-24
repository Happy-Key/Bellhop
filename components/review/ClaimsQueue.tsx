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
import { RECOMMENDATION_LABEL, STAGE_LABEL, type Attention } from "@/lib/domain/triage";
import { caseRef, exactTime, relativeTime, usd } from "./format";
import { AudienceTag, AttentionGlyph } from "./Tags";

type QueueCase = FunctionReturnType<typeof api.review.queue>[number];
type Filter = "all" | Attention;

const GROUPS: { id: Attention; label: string; hint: string }[] = [
  { id: "reviewer", label: "Needs a bank reviewer", hint: "A reviewer can act now" },
  { id: "customer", label: "Needs customer information", hint: "Waiting on answers from the customer" },
  { id: "no_report", label: "No report yet", hint: "Case opened, nothing recorded" },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All open" },
  { id: "reviewer", label: "Reviewer" },
  { id: "customer", label: "Customer" },
  { id: "no_report", label: "No report" },
];

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
      .filter((c) => filter === "all" || c.triage.attention === filter)
      .filter((c) => {
        if (!term) return true;
        const p = paymentSummary(c);
        return [caseRef(c._id), p.text, c.matched?.ref ?? "", c.triage.headline].some((s) => s.toLowerCase().includes(term));
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

  const counts = Object.fromEntries(GROUPS.map((g) => [g.id, cases.filter((c) => c.triage.attention === g.id).length])) as Record<Attention, number>;

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
                <strong>{counts.customer}</strong> · no report yet: <strong>{counts.no_report}</strong>.
              </>
            )}{" "}
            <span className="ws-muted">Live from Convex. Synthetic data.</span>
          </p>
        </div>
        <Link href="/review/demo" className="ws-demo-link">
          <span className="ws-demo-tag">Synthetic demo</span> Guided intake walkthrough →
          <span className="ws-small ws-muted">Scripted scenario, separate from these cases</span>
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
              const rows = visible.filter((c) => c.triage.attention === g.id);
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
  return (
    <div id={`q-${c._id}`} role="option" aria-selected={selected} className="ws-row" onClick={onSelect} onDoubleClick={onOpen}>
      <div className="ws-row-main">
        <span className="ws-row-ref">{caseRef(c._id)}</span>
        <span className="ws-row-payment">{p.text}</span>
        {p.note && <span className="ws-row-note">{p.note}</span>}
      </div>
      <div className="ws-row-next">{c.triage.headline}</div>
      <div className="ws-row-meta">
        {c.triage.reviewerOpen > 0 && <span>{c.triage.reviewerOpen} for bank</span>}
        {c.triage.customerOpen > 0 && <span>{c.triage.customerOpen} for customer</span>}
        {c.triage.steps.some((s) => s.blocking) && <span className="ws-block"><span aria-hidden="true">■</span> blocked</span>}
        {c.conflictCount > 0 && <span className="ws-warn-text">⚠ {c.conflictCount} conflict{c.conflictCount === 1 ? "" : "s"}</span>}
        <span title={c.lastActivity ? exactTime(c.lastActivity.at) : undefined}>{relativeTime(lastTouched(c), now)}</span>
      </div>
    </div>
  );
}

function Preview({ c }: { c: QueueCase }) {
  const p = paymentSummary(c);
  return (
    <div className="ws-preview-body">
      <div className="ws-preview-head">
        <h2>{caseRef(c._id)}</h2>
        <span className="ws-stage">{STAGE_LABEL[c.stage]}</span>
      </div>
      <dl className="ws-facts">
        <dt>Report received</dt>
        <dd>{c.reportedAt ? exactTime(c.reportedAt) : <span className="ws-muted">No statement yet (case opened {exactTime(c.createdAt)})</span>}</dd>
        <dt>Payment</dt>
        <dd>{p.text}{p.note && <span className="ws-muted"> · {p.note}</span>}</dd>
        <dt>Next action</dt>
        <dd>{c.triage.headline}</dd>
        <dt>Blocking issue</dt>
        <dd>{(() => {
          const b = c.triage.steps.find((s) => s.blocking);
          return b ? <>{b.title} <span className="ws-muted">— {b.why}</span></> : <span className="ws-muted">None</span>;
        })()}</dd>
        <dt>Channel</dt>
        <dd>{c.channels.length ? c.channels.join(", ") : "—"} · {c.statementCount} statement{c.statementCount === 1 ? "" : "s"}</dd>
        {c.recommendation && (
          <>
            <dt>Draft recommendation</dt>
            <dd>{RECOMMENDATION_LABEL[c.recommendation.action]} <span className="ws-muted">— {c.recommendation.rationale}</span></dd>
          </>
        )}
        {c.lastActivity && (
          <>
            <dt>Last activity</dt>
            <dd className="ws-clamp-2"><span className="ws-muted">{exactTime(c.lastActivity.at)} · </span>{c.lastActivity.message}</dd>
          </>
        )}
      </dl>
      <h3 className="ws-h3">Next steps</h3>
      {c.triage.steps.length === 0 ? (
        <p className="ws-muted">No open steps.</p>
      ) : (
        <ol className="ws-steps-mini">
          {c.triage.steps.slice(0, 4).map((s) => (
            <li key={s.key}>
              <AudienceTag audience={s.audience} />
              <span className="ws-clamp-2">{s.title}</span>
            </li>
          ))}
          {c.triage.steps.length > 4 && <li className="ws-muted">+{c.triage.steps.length - 4} more</li>}
        </ol>
      )}
      <Link className="ws-btn ws-btn-primary" href={`/review/${c._id}`}>Open case review →</Link>
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
