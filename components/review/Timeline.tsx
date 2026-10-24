"use client";

/** Investigation timeline with category filters. View model: lib/review/timeline.ts. */
import { useState } from "react";
import { buildTimeline, type EventClass, type TimelineEvent } from "@/lib/review/timeline";
import type { DemoReviewEvent } from "@/lib/review/types";
import { goToRef, RefChip } from "./EvidenceRef";
import { clockTime, exactTime, shortTime } from "./format";
import type { CaseView } from "./types";

type Filter = "all" | EventClass | "problem";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reported", label: "Reported" },
  { id: "observed", label: "Observed" },
  { id: "inferred", label: "Inferred" },
  { id: "action", label: "Actions" },
  { id: "problem", label: "Problems" },
];

const matches = (e: TimelineEvent, f: Filter) => f === "all" || (f === "problem" ? e.problem : e.cls === f);

export function Timeline({ data, recordSource, reviewEvents }: { data: CaseView; recordSource: string; reviewEvents?: DemoReviewEvent[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [all, setAll] = useState(false);
  const events = buildTimeline(data, { recordSource, reviewEvents });
  const visible = events.filter((e) => matches(e, filter));
  const LIMIT = 30;
  const shown = all ? visible : visible.slice(-LIMIT);
  return (
    <section id="timeline" className="ws-section" aria-labelledby="timeline-h">
      <div className="ws-section-head">
        <h2 id="timeline-h">Timeline</h2>
        <p className="ws-muted ws-small">
          Oldest first. Bank records carry a date only and are placed at that date. Reviewer activity appears only when it was recorded. Select an event to open its evidence.
        </p>
      </div>
      <div className="ws-segmented ws-segmented-sm" role="group" aria-label="Filter timeline events">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="ws-count">{events.filter((e) => matches(e, f.id)).length}</span>
          </button>
        ))}
      </div>
      {visible.length > LIMIT && !all && (
        <p><button type="button" className="ws-link" onClick={() => setAll(true)}>Show {visible.length - LIMIT} earlier events</button></p>
      )}
      {visible.length === 0 && <p className="ws-muted ws-small">No events in this category.</p>}
      <ol className="ws-timeline">
        {shown.map((e) => (
          <li key={e.id} className={`ws-tl ws-tl-${e.problem ? "problem" : e.cls}`}>
            <span className="ws-tl-mark" aria-hidden="true" />
            <div
              className="ws-tl-body"
              data-clickable={e.refs.length > 0 || undefined}
              onClick={(ev) => { if (e.refs[0] && !(ev.target as HTMLElement).closest("button")) goToRef(e.refs[0]); }}
            >
              <div className="ws-tl-head">
                <span className="ws-tl-kind">{e.label}</span>
                <span className="ws-tl-cls">{e.problem ? "problem" : e.cls}</span>
                {e.at !== null ? (
                  <time dateTime={new Date(e.at).toISOString()} title={exactTime(e.at)}>{clockTime(e.at)}</time>
                ) : (
                  <time dateTime={e.date ?? undefined}>{e.date} <span className="ws-muted">(date only)</span></time>
                )}
                {e.recordedAt !== null && <span title={exactTime(e.recordedAt)}>retrieved {shortTime(e.recordedAt)}</span>}
                <span className="ws-tl-src">{e.source}</span>
                {e.refs.map((r) => <RefChip key={r} refId={r} />)}
                {e.correctsRef && <span>corrects <RefChip refId={e.correctsRef} /></span>}
                {e.demoOnly && <span className="ws-tag">demo, not saved</span>}
              </div>
              {e.question && <div className="ws-tl-q">In reply to “{e.question}”</div>}
              <div className={e.cls === "reported" ? "ws-clamp-2" : "ws-small"}>{e.cls === "reported" ? `“${e.text}”` : e.text}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
