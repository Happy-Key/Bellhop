"use client";

/**
 * Evidence references (S3, T:abc, X:crs:…) with linked highlighting: hovering or focusing a
 * reference marks every element on the page that carries the same ref, and activating it
 * scrolls to the source. Source elements opt in with useIsActive.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { shortRef } from "./format";

interface Ctx { active: string | null; setActive: (ref: string | null) => void }
const HighlightContext = createContext<Ctx>({ active: null, setActive: () => {} });

export function HighlightProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  return <HighlightContext.Provider value={{ active, setActive }}>{children}</HighlightContext.Provider>;
}

export const useHighlight = () => useContext(HighlightContext);

/** Anchor id for a ref, safe for use in URLs and querySelector. */
export const refAnchor = (ref: string) => `ev-${ref.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const KIND: [RegExp, string][] = [
  [/^S\d+$/, "Customer statement"],
  [/^T:/, "Bank record"],
  [/^X:/, "External provider fact"],
  [/^R:/, "Regulatory source"],
];

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
  const kind = KIND.find(([re]) => re.test(refId))?.[1] ?? "Evidence";
  const go = () => goToRef(refId);
  return (
    <button
      type="button"
      className="ws-ref"
      data-on={active === refId || undefined}
      aria-label={`${kind} ${refId}: show source`}
      title={`${kind} ${refId}`}
      onMouseEnter={() => setActive(refId)}
      onMouseLeave={() => setActive(null)}
      onFocus={() => setActive(refId)}
      onBlur={() => setActive(null)}
      onClick={go}
    >
      {label ?? shortRef(refId)}
    </button>
  );
}

/** Wraps a source element so it is highlighted when any chip for its ref is active. */
export function useIsActive(ref: string | null | undefined) {
  const { active } = useHighlight();
  return !!ref && active === ref;
}
