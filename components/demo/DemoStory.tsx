"use client";

/**
 * The demo: one claim told as a scroll-driven story on a single pinned stage, then released into
 * the real case workspace in demo mode. Scroll is the only control (space and the arrow keys scroll
 * by a beat). The customer's lines and the model's outputs are the scripted fixture
 * (lib/fixtures/pitchDemo.ts); the match, validator, policy and guardrails run for real
 * (lib/review/pitchDemo.ts); the final scene is the workspace components with reviewer actions
 * kept in page state. Reduced motion cuts between beats instead of animating.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import type { Id } from "@/convex/_generated/dataModel";
import { PITCH_MATCHED_REF, PITCH_PROPOSAL, PITCH_REASONING, PITCH_TRANSACTIONS, PITCH_TURNS } from "@/lib/fixtures/pitchDemo";
import { REGULATORY_SOURCES } from "@/lib/domain/regulatory";
import { buildPitchCase, pitchWorkspaceData } from "@/lib/review/pitchDemo";
import { buildWorkspace, type ModelState } from "@/components/review/CaseReview";
import { CaseWorkspace } from "@/components/review/CaseWorkspace";
import type { DemoAction } from "@/components/review/WorkspaceContext";
import type { CaseView } from "@/lib/review/types";
import { CallSurface, DocChips, EASE, Fade, GhostAssessment, Guardrails, ModelPanel, ProposalCard, RecordCard, SourceList } from "./objects";
import "./demo.css";

const BEATS = 8;
const RUNWAY_VH = 110;
type Scene = "call" | "evidence" | "model" | "code";
const SCENE: Scene[] = ["call", "call", "evidence", "model", "model", "model", "model", "code"];
const TITLE: Record<number, string> = { 0: "A customer calls.", 1: "The payment is found.", 2: "The evidence assembles.", 3: "Bitdeer investigates.", 4: "The customer adds one thing.", 5: "The assessment changes.", 6: "The investigation follows.", 7: "Checked by code." };

export function DemoStory() {
  const c = useMemo(() => buildPitchCase(), []);
  const reduce = useReducedMotion();
  const runwayRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.setAttribute("data-ready", "");
  }, []);
  const { scrollYProgress } = useScroll({ target: runwayRef, offset: ["start start", "end end"] });
  const [beat, setBeat] = useState(0);
  // Where a key press is taking us, so rapid presses advance from the last target rather than from the beat still on screen.
  const target = useRef<number | null>(null);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const b = Math.max(0, Math.min(BEATS - 1, Math.floor(v * BEATS + 1e-6)));
    if (target.current !== null && b === target.current) target.current = null;
    setBeat(b);
  });

  const scrollToBeat = useCallback(
    (n: number) => {
      const el = runwayRef.current;
      if (!el) return;
      if (n >= BEATS) {
        target.current = null;
        document.getElementById("demo-finale")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
        return;
      }
      target.current = Math.max(0, n);
      const step = (el.offsetHeight - window.innerHeight) / BEATS;
      window.scrollTo({ top: el.offsetTop + Math.max(0, n) * step + 2, behavior: reduce ? "auto" : "smooth" });
    },
    [reduce],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button, dialog")) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        scrollToBeat((target.current ?? beat) + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        scrollToBeat((target.current ?? beat) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beat, scrollToBeat]);

  // ---- Finale: the real workspace in demo mode, with reviewer actions kept in page state. ----
  const { data, proposalRow, previousRow } = useMemo(() => pitchWorkspaceData(c), [c]);
  const [actions, setActions] = useState<CaseView["reviewActions"]>([]);
  const onDemoAction = useCallback((a: DemoAction) => {
    const at = Date.now();
    setActions((prev) => [
      {
        _id: `demo_act_${prev.length + 1}` as Id<"reviewActions">,
        _creationTime: at,
        caseId: data.case._id,
        proposalId: proposalRow._id,
        kind: a.kind === "override" ? ("override" as const) : ("return" as const),
        ...(a.kind === "override" ? { decision: a.decision, reason: a.reason, ...(a.question ? { question: a.question } : {}) } : { reason: a.request }),
        at,
      },
      ...prev,
    ]);
  }, [data.case._id, proposalRow._id]);
  const ws = useMemo(() => {
    const rows = [proposalRow, previousRow];
    const model = {
      enabled: true,
      proposal: proposalRow,
      accepted: proposalRow,
      history: rows.map((r) => ({ _id: r._id, status: "done", trigger: "auto", requestedAt: r.requestedAt, completedAt: r.completedAt, provider: r.provider, decision: r.proposal.decision, changeLog: r.changeLog, resolution: null, problems: r.problems, error: null, current: r.current })),
    } as unknown as ModelState;
    return buildWorkspace({ data: { ...data, reviewActions: actions }, model, mode: "demo" });
  }, [data, proposalRow, previousRow, actions]);

  const scene = SCENE[beat]!;
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"} transition={{ duration: 0.6, ease: EASE }}>
      <div ref={rootRef} className="story">
        <Link href="/review" className="story-back">
          Claims queue
        </Link>
        <span className="story-tag">Scripted replay · synthetic data</span>
        <motion.div className="story-progress" style={{ scaleX: scrollYProgress }} aria-hidden="true" />
        <div ref={runwayRef} className="story-runway" style={{ height: `${BEATS * RUNWAY_VH}vh` }}>
          <div className="story-stage" data-scene={scene}>
            <Stage beat={beat} />
          </div>
        </div>
        <section id="demo-finale" className="story-finale" aria-label="A person decides">
          <div className="story-finale-title">
            <h2>A person decides.</h2>
          </div>
          <CaseWorkspace ws={ws} onDemoAction={onDemoAction} />
        </section>
      </div>
    </MotionConfig>
  );
}

function Stage({ beat }: { beat: number }) {
  const c = useMemo(() => buildPitchCase(), []);
  const matched = PITCH_TRANSACTIONS.find((t) => t.ref === PITCH_MATCHED_REF)!;
  const others = PITCH_TRANSACTIONS.filter((t) => t.ref !== PITCH_MATCHED_REF);
  const turns = PITCH_TURNS.slice(0, beat >= 6 ? 3 : beat >= 4 ? 2 : 1).map((t) => ({ ref: t.ref, text: t.text, question: t.answers?.text }));
  const agentQuestion = beat === 3 ? PITCH_REASONING.before.nextQuestion : beat === 5 ? PITCH_REASONING.after.nextQuestion : null;
  const after = beat >= 5;
  const work = beat >= 6 ? PITCH_PROPOSAL.investigation.workItems : after ? PITCH_REASONING.after.work : PITCH_REASONING.before.work;
  const changed = new Set<string>();
  if (beat === 5) for (const w of PITCH_REASONING.after.work) if (PITCH_REASONING.before.work.find((x) => x.key === w.key)?.status !== w.status) changed.add(w.key);
  if (beat === 6) changed.add("card_exposure");
  const sourceRefs = REGULATORY_SOURCES.map((s) => s.ref);
  const readings = after ? PITCH_PROPOSAL.legalBasis : null;
  const revealed = beat >= 7 ? c.guardrails.length : 0;
  const policy = { passed: c.autoApproval.checks.filter((x) => x.passed).length, total: c.autoApproval.checks.length };

  return (
    <LayoutGroup>
      <div className="stage" data-beat={beat}>
        <AnimatePresence mode="wait">
          <motion.h1 key={TITLE[beat]} className="stage-title" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, transition: { duration: 0.25 } }} transition={{ duration: 0.55, ease: EASE }}>
            {TITLE[beat]}
          </motion.h1>
        </AnimatePresence>

        <div className="stage-grid" data-beat={beat}>
          {/* Column 1: the customer */}
          <motion.div layout className="stage-col stage-customer" transition={{ duration: 0.6, ease: EASE }}>
            <CallSurface turns={turns} question={agentQuestion} live={beat < 7} dim={beat === 7} />
          </motion.div>

          {/* Column 2: the record, then the model */}
          <motion.div layout className="stage-col stage-center" transition={{ duration: 0.6, ease: EASE }}>
            <AnimatePresence>
              {beat >= 1 && beat <= 2 && (
                <Fade key="matched" show>
                  <RecordCard t={matched} matched link="Matched · code" />
                </Fade>
              )}
              {beat === 2 && (
                <Fade key="others" show className="stage-others" delay={0.15}>
                  {others.map((t) => (
                    <RecordCard key={t.ref} t={t} dim compact />
                  ))}
                </Fade>
              )}
              {beat >= 5 && beat <= 6 && (
                <Fade key="ghost" show className="stage-ghost">
                  <GhostAssessment interpretation={PITCH_REASONING.before.interpretation} at="15:03 UTC" />
                </Fade>
              )}
              {beat >= 3 && beat <= 6 && (
                <Fade key="model" show>
                  <ModelPanel was={after ? PITCH_REASONING.before.interpretation : null} interpretation={after ? PITCH_REASONING.after.interpretation : PITCH_REASONING.before.interpretation} work={work} changedKeys={changed} nextQuestion={beat === 3 ? PITCH_REASONING.before.nextQuestion : beat === 5 ? PITCH_REASONING.after.nextQuestion : null} why={beat === 3 ? PITCH_REASONING.before.why : beat === 5 ? PITCH_REASONING.after.why : null} />
                </Fade>
              )}
              {beat === 7 && (
                <Fade key="proposal" show>
                  <ProposalCard proposal={PITCH_PROPOSAL} matchedRef={PITCH_MATCHED_REF} />
                </Fade>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Column 3: sources, the matched record, drafts, guardrails */}
          <motion.div layout className="stage-col stage-right" transition={{ duration: 0.6, ease: EASE }}>
            <AnimatePresence>
              {beat >= 3 && beat <= 6 && (
                <Fade key="matched-compact" show>
                  <RecordCard t={matched} matched compact />
                </Fade>
              )}
              {beat >= 2 && beat <= 6 && (
                <Fade key="sources" show delay={0.2}>
                  <SourceList refs={sourceRefs} readings={readings} compact={beat >= 3} />
                </Fade>
              )}
              {beat >= 5 && beat <= 6 && (
                <Fade key="docs" show delay={0.5}>
                  <DocChips docs={c.proposal.documents.slice(0, 2)} flagged />
                </Fade>
              )}
              {beat === 7 && (
                <Fade key="guards" show>
                  <Guardrails checks={c.guardrails} revealed={revealed} policy={policy} />
                </Fade>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
        <p className="stage-hint" aria-hidden="true">
          {beat < BEATS - 1 ? "Scroll" : "Scroll to the workspace"}
        </p>
      </div>
    </LayoutGroup>
  );
}
