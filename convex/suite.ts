/**
 * Claim suite runner (DEMO / TEST AID, synthetic data only). Plays a demo persona's script
 * (lib/fixtures/demoPersonas.ts) as a customer text chat on a new persona case, through exactly the
 * same path as the /call text chat (chat.ts → recordVoiceUtterance → takeTurn), with live Nessie,
 * CRS and, when configured, Bitdeer. `results` then compares each case with the persona's expected
 * outcome (lib/review/suite.ts). Shown on /review/suite.
 *
 * Runs are staggered so a whole-suite run doesn't hit the providers all at once. Each run is a new
 * case; earlier runs' cases stay until deleted or the deployment is reset (npm run reset:convex).
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { createPersonaCase } from "./personas";
import { sendChatMessage } from "./chat";
import { caseReasoningEnabled } from "./proposals";
import { DEMO_PERSONAS, getDemoPersona, personaPurchaseFor } from "../lib/fixtures/demoPersonas";
import { suiteVerdict, type SuiteObservation } from "../lib/review/suite";
import type { AutoApprovalEvaluation } from "../lib/domain/autoApproval";

/** Delay between starting consecutive runs in one batch. */
const STAGGER_MS = 12_000;
/** How long a run waits for the persona's setup (bank records, CRS checks) before the customer speaks. */
const SETUP_WAIT_MS = 45_000;
const SETUP_KINDS = new Set(["persona_setup_done", "integration_error"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Queues runs for the given personas (every persona when empty). A persona already queued or running is skipped. */
export const start = mutation({
  args: { personaIds: v.array(v.string()) },
  handler: async (ctx, { personaIds }) => {
    const ids = personaIds.length ? personaIds : DEMO_PERSONAS.map((p) => p.id);
    for (const id of ids) if (!getDemoPersona(id)) throw new Error(`unknown demo persona ${id}`);
    const batchId = crypto.randomUUID();
    const now = Date.now();
    let queued = 0;
    for (const personaId of ids) {
      const latest = await ctx.db.query("suiteRuns").withIndex("by_persona", (q) => q.eq("personaId", personaId)).order("desc").first();
      if (latest && (latest.status === "queued" || latest.status === "running")) continue;
      const runId = await ctx.db.insert("suiteRuns", { personaId, batchId, status: "queued", queuedAt: now, transcript: [] });
      await ctx.scheduler.runAfter(queued * STAGGER_MS, internal.suite.runOne, { runId });
      queued++;
    }
    return { queued, skipped: ids.length - queued };
  },
});

export const runOne = internalAction({
  args: { runId: v.id("suiteRuns") },
  handler: async (ctx, { runId }) => {
    const say = (role: "customer" | "assistant", text: string) => ctx.runMutation(internal.suite.appendTranscript, { runId, role, text });
    try {
      const { caseId, script } = await ctx.runMutation(internal.suite.beginRun, { runId });
      // Like a caller who greets the agent first: give the persona's setup a head start.
      const deadline = Date.now() + SETUP_WAIT_MS;
      while (Date.now() < deadline && !(await ctx.runQuery(internal.suite.setupFinished, { caseId }))) await sleep(1500);
      const chat = await ctx.runMutation(api.chat.startChat, { caseId });
      let questionId: string | null = null;
      for (const [i, line] of script.entries()) {
        await say("customer", line);
        const r = await sendChatMessage(ctx, {
          sessionToken: chat.token,
          text: line,
          messageId: `suite_${runId}_${i}`.slice(0, 64),
          ...(questionId ? { questionId } : {}),
        });
        questionId = r.question_id;
        if (r.question) await say("assistant", r.question);
        if (r.end_call) break;
      }
      await ctx.runMutation(internal.suite.finishRun, { runId });
    } catch (e) {
      await ctx.runMutation(internal.suite.finishRun, { runId, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
    }
  },
});

export const beginRun = internalMutation({
  args: { runId: v.id("suiteRuns") },
  handler: async (ctx, { runId }): Promise<{ caseId: Id<"cases">; script: string[] }> => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("suite run not found");
    const persona = getDemoPersona(run.personaId);
    if (!persona) throw new Error(`unknown demo persona ${run.personaId}`);
    const caseId = await createPersonaCase(ctx, persona.id);
    await ctx.db.patch(runId, { status: "running", startedAt: Date.now(), caseId });
    return { caseId, script: persona.script };
  },
});

export const appendTranscript = internalMutation({
  args: { runId: v.id("suiteRuns"), role: v.union(v.literal("customer"), v.literal("assistant")), text: v.string() },
  handler: async (ctx, { runId, role, text }) => {
    const run = await ctx.db.get(runId);
    if (run) await ctx.db.patch(runId, { transcript: [...run.transcript, { role, text, at: Date.now() }] });
  },
});

export const finishRun = internalMutation({
  args: { runId: v.id("suiteRuns"), error: v.optional(v.string()) },
  handler: async (ctx, { runId, error }) => {
    if (!(await ctx.db.get(runId))) return;
    await ctx.db.patch(runId, { status: error ? "error" : "done", finishedAt: Date.now(), ...(error ? { error } : {}) });
  },
});

export const setupFinished = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const rows = await ctx.db.query("activity").withIndex("by_case", (q) => q.eq("caseId", caseId)).collect();
    return rows.some((a) => SETUP_KINDS.has(a.kind));
  },
});

/** Every persona with its expected outcome, its latest run, and how that run's case compares. */
export const results = query({
  args: {},
  handler: async (ctx) => {
    const modelEnabled = caseReasoningEnabled();
    return Promise.all(
      DEMO_PERSONAS.map(async (p) => {
        const run = await ctx.db.query("suiteRuns").withIndex("by_persona", (q) => q.eq("personaId", p.id)).order("desc").first();
        const c = run?.caseId ? await ctx.db.get(run.caseId) : null;
        const observation = run && c ? await observe(ctx, c, p.id, run, modelEnabled) : null;
        return {
          persona: { id: p.id, name: p.name, group: p.group, scenario: p.scenario, disputedKey: p.disputedKey, expected: p.expected, crsPersonaId: p.crsPersonaId },
          run: run ? { status: run.status, queuedAt: run.queuedAt, startedAt: run.startedAt ?? null, finishedAt: run.finishedAt ?? null, error: run.error ?? null, transcript: run.transcript, caseId: run.caseId ?? null, caseDeleted: !!run.caseId && !c } : null,
          observation,
          verdict: observation ? suiteVerdict(p.expected, p.disputedKey, observation) : null,
        };
      }),
    );
  },
});

async function observe(
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  c: Doc<"cases">,
  personaId: string,
  run: Doc<"suiteRuns">,
  modelEnabled: boolean,
): Promise<SuiteObservation> {
  const persona = getDemoPersona(personaId)!;
  const [statements, activity, proposals, decisions] = await Promise.all([
    ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
    ctx.db.query("activity").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
    ctx.db.query("caseProposals").withIndex("by_case", (q) => q.eq("caseId", c._id)).order("desc").take(20),
    ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", c._id)).collect(),
  ]);
  const newest = proposals[0] ?? null;
  const accepted = proposals.find((x) => x.status === "done") ?? null;
  const pending =
    run.status === "queued" || run.status === "running"
      ? "The script is still being played."
      : !activity.some((a) => SETUP_KINDS.has(a.kind))
        ? "Persona setup (bank records, CRS checks) hasn't finished."
        : statements.some((s) => s.interpretationStatus === "pending")
          ? "A statement is still being interpreted."
          : newest?.status === "pending"
            ? "The model is reassessing the case."
            : null;

  const matchedRef = (c.analysis as { match?: { matchedRef?: string | null } } | null)?.match?.matchedRef ?? null;
  const matched = matchedRef
    ? (await ctx.db.query("transactions").withIndex("by_case_ref", (q) => q.eq("caseId", c._id).eq("ref", matchedRef)).collect()).find((t) => t.supersededAt === undefined) ?? null
    : null;
  const evaluation = (c.autoApproval ?? null) as AutoApprovalEvaluation | null;
  return {
    pending,
    matchedKey: matched && matched.kind === "purchase" ? personaPurchaseFor(persona, matched)?.key ?? `unknown record ${matched.ref}` : null,
    failingChecks: evaluation ? evaluation.checks.filter((x) => !x.passed).map((x) => x.id) : null,
    autoApproved: decisions.some((d) => d.outcome === "auto_approved"),
    unreadStatements: statements.filter((s) => s.interpretationStatus === "failed").map((s) => ({ ref: s.ref, error: s.interpretationError ?? "failed" })),
    model: {
      state: !modelEnabled ? "off" : !newest ? "none" : newest.status === "pending" ? "pending" : newest.status === "done" ? "done" : newest.status === "rejected_by_validation" ? "rejected" : "failed",
      decision: (accepted?.proposal as { decision?: string } | undefined)?.decision ?? null,
      problem: newest && (newest.status === "failed" || newest.status === "rejected_by_validation") ? (newest.error ?? (newest.problems ?? []).join("; ")) || null : null,
    },
  };
}
