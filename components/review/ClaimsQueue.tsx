"use client";

/**
 * Claims queue: every case grouped by who has to act, the counts as filters. Selection lives in the
 * URL (?case=<id>). Keyboard: ↑/↓/Home/End move the selection, Enter opens the case. Rows move
 * between groups as cases are reassessed; the move is animated, skipped under reduced motion.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { api } from "@/convex/_generated/api";
import type { CaseAttention } from "@/lib/review/caseStatus";
import { DECISION_SHORT, customerName } from "@/lib/review/labels";
import { caseRef, exactTime, relativeTime, usd } from "./format";
import { Mark, Pill, type MarkKind, type Tone } from "./ui";

type QueueCase = FunctionReturnType<typeof api.review.queue>[number];
type Filter = "all" | CaseAttention;

const GROUPS: { id: CaseAttention; label: string; mark: MarkKind; tone: Tone }[] = [
  { id: "reviewer", label: "Needs a reviewer", mark: "bank", tone: "accent" },
  { id: "customer", label: "Waiting on the customer", mark: "customer", tone: "warn" },
  { id: "system", label: "Investigating", mark: "model", tone: "neutral" },
  { id: "auto_approved", label: "Approved automatically", mark: "policy", tone: "ok" },
  { id: "decided", label: "Decided by a person", mark: "person", tone: "ok" },
  { id: "no_report", label: "No report", mark: "customer", tone: "quiet" },
];

const lastTouched = (c: QueueCase) => c.lastActivity?.at ?? c.createdAt;

function paymentOf(c: QueueCase): { amount: string | null; sub: string } {
  if (c.matched) return { amount: usd(c.matched.amount), sub: `${c.matched.merchant ?? "Unknown merchant"} · ${c.matched.date ?? ""}` };
  const r = c.reported;
  if (r.amount !== null || r.merchant) return { amount: r.amount !== null ? usd(r.amount) : null, sub: `${r.merchant ?? "payee unknown"} · ${c.candidateCount > 1 ? `${c.candidateCount} possible records` : c.bankFetchStatus === "ok" ? "not matched" : "records not retrieved"}` };
  return { amount: null, sub: "No payment details" };
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
  const [showEmpty, setShowEmpty] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const reduce = useReducedMotion();

  const visible = useMemo(() => {
    if (!cases) return [];
    const term = search.trim().toLowerCase();
    return cases
      .filter((c) => (filter === "all" ? showEmpty || c.status.attention !== "no_report" : c.status.attention === filter))
      .filter((c) => {
        if (!term) return true;
        const p = paymentOf(c);
        return [caseRef(c._id), customerName(c).name, p.amount ?? "", p.sub, c.matched?.ref ?? "", c.status.headline, ...c.status.work.map((w) => w.title)].some((s) => s.toLowerCase().includes(term));
      })
      .sort((a, b) => GROUPS.findIndex((g) => g.id === a.status.attention) - GROUPS.findIndex((g) => g.id === b.status.attention) || lastTouched(b) - lastTouched(a));
  }, [cases, filter, search, showEmpty]);

  const selected = visible.find((c) => c._id === selectedId) ?? null;
  const select = (id: string) => router.replace(`/review?case=${id}`, { scroll: false });
  const open = (id: string) => router.push(`/review/${id}`);

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
    <main className="page">
      <div className="page-head">
        <h1>Claims Queue</h1>
      </div>

      <div className="q-stats" role="group" aria-label="Filter by who needs to act">
        {GROUPS.filter((g) => g.id !== "no_report").map((g) => (
          <button key={g.id} type="button" className="q-stat" aria-pressed={filter === g.id} onClick={() => setFilter(filter === g.id ? "all" : g.id)}>
            <span className="q-stat-n">{counts[g.id]}</span>
            <span>{g.label}</span>
          </button>
        ))}
      </div>

      <div className="q-toolbar" role="search">
        <label className="q-search">
          <span className="visually-hidden">Search cases</span>
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="q-toggle">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Cases with no report ({counts.no_report})
        </label>
      </div>

      {cases.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No claims yet.</strong>
          </p>
        </div>
      ) : (
        <div className="q-layout">
          <div ref={listRef} className="q-list" role="listbox" tabIndex={0} aria-label="Cases" aria-activedescendant={selected ? `q-${selected._id}` : undefined} onKeyDown={onKeyDown}>
            {visible.length === 0 && <p className="muted ins-pad">No matching cases.</p>}
            <LayoutGroup>
              {GROUPS.map((g) => {
                const rows = visible.filter((c) => c.status.attention === g.id);
                if (rows.length === 0) return null;
                return (
                  <motion.div key={g.id} role="group" aria-labelledby={`grp-${g.id}`} className="q-group" layout={!reduce}>
                    <div className="q-group-head" id={`grp-${g.id}`}>
                      <Mark kind={g.mark} labelled={false} />
                      {g.label} <span className="count">{rows.length}</span>
                    </div>
                    <AnimatePresence initial={false}>
                      {rows.map((c) => (
                        <motion.div key={c._id} layout={!reduce} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.2 }}>
                          <QueueRow
                            c={c}
                            now={now}
                            tone={g.tone}
                            selected={c._id === selected?._id}
                            onSelect={() => {
                              if (window.matchMedia("(max-width: 900px)").matches) open(c._id);
                              else select(c._id);
                              listRef.current?.focus({ preventScroll: true });
                            }}
                            onOpen={() => open(c._id)}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </LayoutGroup>
          </div>
          <aside className="q-preview card" aria-label="Selected case">
            {selected ? <Preview c={selected} /> : <p className="muted">Select a case.</p>}
          </aside>
        </div>
      )}
    </main>
  );
}

function QueueRow({ c, now, tone, selected, onSelect, onOpen }: { c: QueueCase; now: number; tone: Tone; selected: boolean; onSelect: () => void; onOpen: () => void }) {
  const p = paymentOf(c);
  const who = customerName(c);
  return (
    <div id={`q-${c._id}`} role="option" aria-selected={selected} className="q-row" onClick={onSelect} onDoubleClick={onOpen}>
      <div className="q-case">
        <span className="q-ref">{caseRef(c._id)}</span>
        <span className="q-name" title={who.name}>
          {who.name}
        </span>
      </div>
      <div className="q-pay">
        <span className="q-amt">{p.amount ?? "—"}</span>
        <span className="q-merchant">{p.sub}</span>
      </div>
      <div className="q-next">
        <span>
          <Pill tone={tone}>{c.status.statusLabel}</Pill>
          {c.status.disposition && !c.status.outcome && (
            <Pill tone="quiet">
              {DECISION_SHORT[c.status.disposition.decision]}
              {c.status.disposition.amount !== null ? ` ${usd(c.status.disposition.amount)}` : ""}
            </Pill>
          )}
        </span>
        <span className="q-next-text" title={c.status.headline}>
          {c.status.headline}
        </span>
      </div>
      <div className="q-meta">
        <span title={c.lastActivity ? exactTime(c.lastActivity.at) : undefined}>{relativeTime(lastTouched(c), now)}</span>
        {c.status.blockers.length > 0 && (
          <span className="q-block">
            <Mark kind="blocking" labelled={false} /> {c.status.blockers.length} blocking
          </span>
        )}
      </div>
    </div>
  );
}

function Preview({ c }: { c: QueueCase }) {
  const p = paymentOf(c);
  const s = c.status;
  const who = customerName(c);
  const g = GROUPS.find((x) => x.id === s.attention)!;
  const active = s.work.filter((w) => w.status !== "done" && w.status !== "not_needed");
  const done = s.work.filter((w) => w.status === "done");
  return (
    <div>
      <div className="q-preview-head">
        <div>
          <span className="q-ref">{caseRef(c._id)}</span>
          <h2>{who.name}</h2>
        </div>
        <Pill tone={g.tone}>{s.statusLabel}</Pill>
      </div>
      {s.summary && <p className="q-preview-sum">{s.summary}</p>}
      <dl className="q-facts">
        <dt>Payment</dt>
        <dd>
          {p.amount ?? "—"} <span className="muted">· {p.sub}</span>
        </dd>
        <dt>Next</dt>
        <dd>
          <strong>{s.headline}</strong>
        </dd>
        {s.disposition && (
          <>
            <dt>Proposed</dt>
            <dd>
              {DECISION_SHORT[s.disposition.decision]}
              {s.disposition.amount !== null ? ` · ${usd(s.disposition.amount)}` : ""}
              {!s.disposition.current && <span className="muted"> · case changed since</span>}
            </dd>
          </>
        )}
        {s.outcome && (
          <>
            <dt>Authorized</dt>
            <dd>
              {s.outcome.label}
              {s.outcome.needsReview && <span className="error"> · flagged</span>}
            </dd>
          </>
        )}
        <dt>Reported</dt>
        <dd>{c.reportedAt ? exactTime(c.reportedAt) : <span className="muted">—</span>}</dd>
      </dl>
      {s.work.length > 0 && (
        <ol className="q-steps">
          {active.map((w) => (
            <li key={w.key}>
              <strong>{w.title}</strong>
            </li>
          ))}
          {done.map((w) => (
            <li key={w.key} className="muted">
              ✓ {w.doneTitle ?? w.title}
            </li>
          ))}
        </ol>
      )}
      <Link className="btn btn-primary" href={`/review/${c._id}`}>
        Open
      </Link>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <main className="page" aria-busy="true">
      <div className="page-head">
        <h1>Claims Queue</h1>
      </div>
      <div className="q-layout">
        <div className="q-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skel" style={{ height: 56, margin: 8 }} />
          ))}
        </div>
        <aside className="q-preview card" />
      </div>
    </main>
  );
}
