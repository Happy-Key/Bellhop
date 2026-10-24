"use client";

/**
 * Evidence references (S3, T:abc, X:crs:…, R:…) with linked highlighting: hovering or focusing a
 * reference marks every element on the page that carries the same ref. Activating one opens the
 * source in the inspector (inside a workspace) or scrolls to the source element (elsewhere).
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { shortRef } from "./format";
import { useWorkspaceOptional } from "./WorkspaceContext";

interface Ctx {
  active: string | null;
  setActive: (ref: string | null) => void;
}
const HighlightContext = createContext<Ctx>({ active: null, setActive: () => {} });

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <HighlightContext.Provider value={{ active, setActive }}>{children}</HighlightContext.Provider>;
}

export const useHighlight = () => useContext(HighlightContext);

/** Anchor id for a ref, safe for use in URLs and querySelector. */
export const refAnchor = (ref: string) => `ev-${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const KIND: [RegExp, string, string][] = [
  [/^S\d+$/, "Customer statement", "customer"],
  [/^T:/, "Bank record", "record"],
  [/^X:/, "Provider fact", "provider"],
  [/^R:/, "Source", "source"],
];

export const refKindLabel = (refId: string) => KIND.find(([re]) => re.test(refId))?.[1] ?? "Evidence";
/** Short kind token for styling: customer, record, provider, source or evidence. */
export const refKindToken = (refId: string) => KIND.find(([re]) => re.test(refId))?.[2] ?? "evidence";

/** Scrolls to and focuses the source element for a ref, opening collapsed sections that hold it. */
export function goToRef(refId: string) {
  const el = document.getElementById(refAnchor(refId));
  if (!el) return;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

export function RefChip({ refId, label }: { refId: string; label?: string }) {
  const { active, setActive } = useHighlight();
  const ws = useWorkspaceOptional();
  const kind = refKindLabel(refId);
  const selected = ws ? ws.isSelected({ kind: "evidence", ref: refId }) : false;
  const open = () => {
    if (ws) ws.select({ kind: "evidence", ref: refId });
    else goToRef(refId);
  };
  return (
    <button
      type="button"
      className="ws-ref"
      data-kind={refKindToken(refId)}
      data-on={active === refId || undefined}
      aria-pressed={ws ? selected : undefined}
      aria-label={`${kind} ${refId}: inspect`}
      title={`${kind} ${refId}`}
      onMouseEnter={() => setActive(refId)}
      onMouseLeave={() => setActive(null)}
      onFocus={() => setActive(refId)}
      onBlur={() => setActive(null)}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
    >
      {label ?? shortRef(refId)}
    </button>
  );
}

/** A row of chips for a list of refs, deduplicated; regulatory refs are left out unless `withSources`. */
export function RefChips({ refs, withSources = false }: { refs: readonly string[]; withSources?: boolean }) {
  const list = [...new Set(refs)].filter((r) => withSources || !r.startsWith("R:"));
  if (list.length === 0) return null;
  return (
    <span className="ws-refs">
      {list.map((r) => (
        <RefChip key={r} refId={r} />
      ))}
    </span>
  );
}

/** Wraps a source element so it is highlighted when any chip for its ref is active. */
export function useIsActive(ref: string | null | undefined) {
  const { active } = useHighlight();
  return !!ref && active === ref;
}
