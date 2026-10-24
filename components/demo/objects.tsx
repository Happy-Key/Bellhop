"use client";

/**
 * The objects of the demo story. Each is one thing from the case (a statement, a record, a source,
 * the model's assessment, a guardrail check) drawn in the treatment of its kind: customer objects
 * are speech, deterministic objects are mono and square, the model's are marked ▶, a person's ●.
 * They persist across beats and move; their content comes from the fixture, never from here.
 */
import Image from "next/image";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { CaseProposal } from "@/lib/domain/caseDecision";
import type { WorkItem } from "@/lib/domain/investigation";
import { getSource } from "@/lib/domain/regulatory";
import type { TransactionEvidence } from "@/lib/domain/schemas";
import type { GuardrailCheck } from "@/lib/review/pitchDemo";
import { DOC_LABEL, READING_LABEL } from "@/lib/review/labels";
import { usd } from "@/components/review/format";
import { Mark } from "@/components/review/ui";

export const EASE = [0.22, 1, 0.36, 1] as const;

export function Fade({ show, children, className, delay = 0, layoutId }: { show: boolean; children: ReactNode; className?: string; delay?: number; layoutId?: string }) {
  if (!show) return null;
  return (
    <motion.div layout layoutId={layoutId} className={className} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }} transition={{ duration: 0.55, ease: EASE, delay }}>
      {children}
    </motion.div>
  );
}

/* ---------- Customer ---------- */

export function CallSurface({ turns, question, live, dim }: { turns: { ref: string; text: string; question?: string }[]; question: string | null; live: boolean; dim: boolean }) {
  return (
    <div className={`d-call${dim ? " is-dim" : ""}`}>
      <div className="d-call-head">
        <span className="d-wave" data-live={live || undefined} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <Image src="/bellhop.png" alt="" width={20} height={20} className="d-call-avatar" />
        <span>Bellhop · voice</span>
        <span className="d-sim">Simulated voice</span>
      </div>
      <ol className="d-turns">
        {turns.map((t) => (
          <li key={t.ref} className="d-turn">
            {t.question && (
              <motion.p className="d-bubble d-agent" layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
                {t.question}
              </motion.p>
            )}
            <motion.p className="d-bubble d-customer" layoutId={`stmt-${t.ref}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: t.question ? 0.35 : 0 }}>
              {t.text}
              <span className="d-ref">{t.ref}</span>
            </motion.p>
          </li>
        ))}
        {question && (
          <li className="d-turn">
            <motion.p className="d-bubble d-agent d-asking" layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.5 }}>
              {question}
            </motion.p>
          </li>
        )}
      </ol>
    </div>
  );
}

/* ---------- Deterministic ---------- */

export function RecordCard({ t, matched, dim, compact, link }: { t: TransactionEvidence; matched?: boolean; dim?: boolean; compact?: boolean; link?: string }) {
  return (
    <motion.div layoutId={`rec-${t.ref}`} className={`d-record${matched ? " is-matched" : ""}${dim ? " is-dim" : ""}${compact ? " is-compact" : ""}`} transition={{ duration: 0.6, ease: EASE }}>
      {link && <span className="d-link-label">{link}</span>}
      <span className="d-record-amt">{usd(t.amount)}</span>
      <span className="d-record-payee">{t.merchantName}</span>
      <span className="d-record-meta">
        {t.date} · {t.status}
        <span className="d-ref">{t.ref.replace("T:demo-", "T:")}</span>
      </span>
    </motion.div>
  );
}

export function SourceList({ refs, readings, compact }: { refs: string[]; readings: CaseProposal["legalBasis"] | null; compact?: boolean }) {
  return (
    <ul className={`d-sources${compact ? " is-compact" : ""}`}>
      {refs.map((ref) => {
        const s = getSource(ref);
        const r = readings?.find((x) => x.sourceRef === ref) ?? null;
        return (
          <motion.li key={ref} layoutId={`src-${ref}`} className="d-source" data-reading={r?.reading} transition={{ duration: 0.6, ease: EASE }}>
            <span className="d-source-cite">{s?.citation ?? ref}</span>
            {!compact && <span className="d-source-title">{s?.title}</span>}
            {r && (
              <motion.span className="d-reading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
                {READING_LABEL[r.reading]}
              </motion.span>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

export function Guardrails({ checks, revealed, policy }: { checks: GuardrailCheck[]; revealed: number; policy: { passed: number; total: number } }) {
  return (
    <div className="d-guards">
      <span className="d-kicker">
        <Mark kind="policy" labelled={false} /> Checked by code
      </span>
      <ul>
        {checks.map((g, i) => (
          <motion.li key={g.label} data-failed={!g.passed || undefined} initial={{ opacity: 0.25 }} animate={{ opacity: i < revealed ? 1 : 0.25 }} transition={{ duration: 0.35, delay: i * 0.12 }}>
            <span className="d-check" aria-hidden="true">
              {i < revealed ? (g.passed ? "✓" : "✕") : "·"}
            </span>
            {g.label}
          </motion.li>
        ))}
      </ul>
      <motion.p className="d-policy" initial={{ opacity: 0 }} animate={{ opacity: revealed >= checks.length ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.6 }}>
        Small-claim policy · {policy.passed} of {policy.total} checks pass · a person decides
      </motion.p>
    </div>
  );
}

/* ---------- Model ---------- */

export function ModelPanel({ was, interpretation, work, changedKeys, nextQuestion, why }: { was: string | null; interpretation: string; work: WorkItem[]; changedKeys: Set<string>; nextQuestion: string | null; why: string | null }) {
  return (
    <motion.div layoutId="model-panel" className="d-model" transition={{ duration: 0.6, ease: EASE }}>
      <span className="d-kicker">
        <Mark kind="model" labelled={false} /> Bitdeer · scripted replay
      </span>
      <div className="d-interp">
        {was && (
          <motion.s initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            {was}
          </motion.s>
        )}
        <motion.strong key={interpretation} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: was ? 0.4 : 0 }}>
          {interpretation}
        </motion.strong>
      </div>
      <ul className="d-work">
        {work.map((w, i) => {
          const done = w.status === "done";
          return (
            <motion.li key={w.key} layout data-status={w.status} data-changed={changedKeys.has(w.key) || undefined} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.15 + i * 0.1 }}>
              <span className="d-work-mark" aria-hidden="true" />
              <span>
                {done ? (w.doneTitle ?? w.title) : w.title}
                {done && w.outcome && <span className="d-work-out">{w.outcome}</span>}
                {!done && <span className="d-work-wait">waiting on the customer</span>}
              </span>
            </motion.li>
          );
        })}
      </ul>
      {nextQuestion && (
        <motion.p className="d-next" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.7 }}>
          <span className="d-kicker">Next</span>
          Ask: “{nextQuestion}”{why && <span className="d-why">{why}</span>}
        </motion.p>
      )}
    </motion.div>
  );
}

export function GhostAssessment({ interpretation, at }: { interpretation: string; at: string }) {
  return (
    <div className="d-ghost">
      <span className="d-kicker">Previous assessment · kept</span>
      <s>{interpretation}</s>
      <span className="d-ghost-at">{at}</span>
    </div>
  );
}

export function DocChips({ docs, flagged }: { docs: CaseProposal["documents"]; flagged: boolean }) {
  return (
    <ul className="d-docs">
      {docs.map((d, i) => (
        <motion.li key={`${d.kind}-${i}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: i * 0.1 }} data-flagged={flagged || undefined}>
          <span>{DOC_LABEL[d.kind]}</span>
          {flagged ? <span className="d-flag">Needs reassessment</span> : <span className="d-draft">Draft</span>}
        </motion.li>
      ))}
    </ul>
  );
}

export function ProposalCard({ proposal, matchedRef }: { proposal: CaseProposal; matchedRef: string }) {
  return (
    <motion.div layoutId="proposal" className="d-proposal" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: EASE }}>
      <span className="d-kicker">
        <Mark kind="model" labelled={false} /> Proposed
      </span>
      <strong>Escalate to a specialist</strong>
      <ol>
        {proposal.rationale.slice(0, 3).map((r) => (
          <li key={r.point}>
            {r.point}
            <span className="d-refs">{r.refs.map((x) => (x === matchedRef ? "T:giftcard-49" : x)).join(" · ")}</span>
          </li>
        ))}
      </ol>
      <span className="d-proposal-note">Applied without a person · nothing decided · no money moves</span>
    </motion.div>
  );
}
