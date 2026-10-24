"use client";

/**
 * Small composed primitives for the workstation: provenance marks (shape plus label), status pills,
 * selectable rows, an accessible tab strip, and a native-dialog action form.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export type MarkKind = "reported" | "observed" | "inferred" | "recommended" | "customer" | "bank" | "blocking" | "model" | "person" | "policy";

const MARK_LABEL: Record<MarkKind, string> = {
  reported: "Reported",
  observed: "Observed",
  inferred: "Inferred",
  recommended: "Recommended",
  customer: "Customer",
  bank: "Bank",
  blocking: "Blocking",
  model: "Model",
  person: "Person",
  policy: "Policy",
};

function Shape({ kind }: { kind: MarkKind }) {
  switch (kind) {
    case "reported":
    case "customer":
      return <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />;
    case "observed":
    case "bank":
    case "blocking":
      return <rect x="1.8" y="1.8" width="8.4" height="8.4" rx="1" fill="currentColor" />;
    case "inferred":
      return <path d="M6 1.3 10.7 6 6 10.7 1.3 6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />;
    case "recommended":
    case "model":
      return <path d="M2.6 1.6 10.6 6 2.6 10.4Z" fill="currentColor" />;
    case "person":
      return <path d="M6 1.6a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6ZM1.8 10.6c.4-2.4 2.1-3.6 4.2-3.6s3.8 1.2 4.2 3.6Z" fill="currentColor" />;
    case "policy":
      return <path d="M6 1.4 10.4 3.3v3.2c0 2.2-1.9 3.6-4.4 4.3C3.5 10.1 1.6 8.7 1.6 6.5V3.3Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  }
}

/** A provenance or audience mark. The label is part of the mark unless `labelled={false}`, in which case it is the accessible name. */
export function Mark({ kind, label, labelled = true, className }: { kind: MarkKind; label?: string; labelled?: boolean; className?: string }) {
  const text = label ?? MARK_LABEL[kind];
  return (
    <span className={`mark mark-${kind}${className ? ` ${className}` : ""}`} aria-label={labelled ? undefined : text} title={labelled ? undefined : text}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <Shape kind={kind} />
      </svg>
      {labelled && text}
    </span>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "crit" | "accent" | "quiet";

export function Pill({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span className={`pill${tone === "neutral" ? "" : ` pill-${tone}`}${className ? ` ${className}` : ""}`} title={title}>
      {children}
    </span>
  );
}

/** A selectable row: one button for the item, evidence chips beside it (outside the button). */
export function Row({ selected, onSelect, lead, children, chips, className, status }: { selected?: boolean; onSelect?: () => void; lead?: ReactNode; children: ReactNode; chips?: ReactNode; className?: string; status?: string }) {
  const body = (
    <>
      {lead}
      <span className="row-text">{children}</span>
    </>
  );
  return (
    <li className={`row${className ? ` ${className}` : ""}`} data-selected={selected || undefined} data-status={status}>
      {onSelect ? (
        <button type="button" className="row-main" aria-pressed={selected} onClick={onSelect}>
          {body}
        </button>
      ) : (
        <span className="row-main row-static">{body}</span>
      )}
      {chips}
    </li>
  );
}

export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

/** Roving-tabindex tab strip. Panels are rendered by the caller with role="tabpanel". */
export function Tabs({ tabs, value, onChange, label, idPrefix }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; idPrefix: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const n = tabs.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && <span className="tabs-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface ActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
  confirm: string;
  onConfirm: () => void;
  busy?: boolean;
  error?: string | null;
  destructive?: boolean;
}

/** A modal form on the native <dialog>: focus is trapped, Escape cancels, the page behind is inert. */
export function ActionDialog({ open, onClose, title, intro, children, confirm, onConfirm, busy, error, destructive }: ActionDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <h2 id={titleId}>{title}</h2>
          {intro && <p className="dlg-intro">{intro}</p>}
          {children}
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          <div className="dlg-actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={`btn ${destructive ? "btn-danger" : "btn-primary"}`} disabled={busy}>
              {busy ? "Working…" : confirm}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Reads a thrown Convex error down to its human sentence. */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^.*Uncaught Error: /s, "").split("\n")[0] ?? m;
}
