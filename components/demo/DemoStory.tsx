"use client";

/**
 * The demo: one claim told as a scroll-driven story on a single pinned stage. Scrolling past the
 * last beat (or pressing on from it) opens the customer line, where the real call begins. Scroll is
 * the only control (space and the arrow keys scroll by a beat). The customer's lines and the model's
 * outputs are the scripted fixture (lib/fixtures/pitchDemo.ts); the match, validator, policy and
 * guardrails run for real (lib/review/pitchDemo.ts). Reduced motion cuts between beats.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll } from "motion/react";
import { PITCH_MATCHED_REF, PITCH_PROPOSAL, PITCH_REASONING, PITCH_TRANSACTIONS, PITCH_TURNS } from "@/lib/fixtures/pitchDemo";
import { REGULATORY_SOURCES } from "@/lib/domain/regulatory";
import { buildPitchCase } from "@/lib/review/pitchDemo";
import { CallSurface, DocChips, EASE, Fade, GhostAssessment, Guardrails, ModelPanel, ProposalCard, RecordCard, SourceList } from "./objects";
import "./demo.css";

const BEATS = 8;
const RUNWAY_VH = 110;
type Scene = "call" | "evidence" | "model" | "code";
const SCENE: Scene[] = ["call", "call", "evidence", "model", "model", "model", "model", "code"];
const TITLE: Record<number, string> = { 0: "A Customer Calls.", 1: "The Payment Is Found.", 2: "The Evidence Assembles.", 3: "Bitdeer Investigates.", 4: "The Customer Adds One Thing.", 5: "The Assessment Changes.", 6: "The Investigation Follows.", 7: "Checked by Code." };

export function DemoStory() {
  const router = useRouter();
  const reduce = useReducedMotion();
  // Leaving for the customer line happens once, whether by scroll or by key.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    router.push("/call");
  }, [router]);
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
        leave();
        return;
      }
      target.current = Math.max(0, n);
      const step = (el.offsetHeight - window.innerHeight) / BEATS;
      window.scrollTo({ top: el.offsetTop + Math.max(0, n) * step + 2, behavior: reduce ? "auto" : "smooth" });
    },
    [reduce, leave],
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

  // ---- Exit: a short runway past the last beat; reaching it opens the customer line. ----
  const exitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = exitRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.intersectionRatio >= 0.6) && leave(), { threshold: [0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, [leave]);

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
        <div ref={exitRef} className="story-exit" aria-hidden="true">
          <span>Opening the customer line…</span>
        </div>
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
          {beat < BEATS - 1 ? "Scroll" : "Scroll to the customer line"}
        </p>
      </div>
    </LayoutGroup>
  );
}
