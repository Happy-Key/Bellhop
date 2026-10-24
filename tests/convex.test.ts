// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CLOSING_MESSAGE, WRAP_UP_COMPLETE_PROMPT, WRAP_UP_PROMPT } from "../lib/domain/voiceTurn";

const modules = import.meta.glob("../convex/**/*.*s");

describe("Convex case workflow", () => {
  it("records statements idempotently and recomputes analysis", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    const args = { caseId, text: "I did not make the $389 purchase", clientEventId: "evt-00000001" };
    const first = await t.mutation(api.cases.submitStatement, args);
    const retry = await t.mutation(api.cases.submitStatement, args);
    expect(first).toEqual({ duplicate: false, ref: "S1" });
    expect(retry).toEqual({ duplicate: true, ref: "S1" });

    const view = await t.query(api.cases.view, { caseId });
    expect(view?.statements).toHaveLength(1);
    expect(view?.statements[0]?.interpretation?.mode).toBe("scripted");
    expect((view?.case.analysis as { stage: string }).stage).toBe("retrieve_evidence");
  });

  it("links a correction, keeps the original, and rejects unknown correction targets", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "There's a $49 charge", clientEventId: "evt-00000001" });
    await t.mutation(api.cases.submitStatement, { caseId, text: "Actually it was at GiftCard Hub", clientEventId: "evt-00000002" });
    await expect(t.mutation(api.cases.submitStatement, { caseId, text: "x", clientEventId: "evt-00000003", correctsRef: "S99" })).rejects.toThrow(/does not exist/);
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.statements.map((s) => [s.ref, s.text, s.correctsRef])).toEqual([
      ["S1", "There's a $49 charge", undefined],
      ["S2", "Actually it was at GiftCard Hub", "S1"],
    ]);
  });

  it("stores live transactions and records retrieval failures without fixtures", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $389 purchase", clientEventId: "evt-00000001" });
    await t.mutation(internal.cases.recordBankFetchError, { caseId, error: "HTTP 503" });
    let view = await t.query(api.cases.view, { caseId });
    expect(view?.transactions).toHaveLength(0);
    expect(view?.case.bankFetch.status).toBe("error");

    const txn = { ref: "T:p-1", provider: "nessie" as const, externalId: "p-1", kind: "purchase" as const, amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "Volt", status: "executed", medium: "balance" };
    await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
    await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
    view = await t.query(api.cases.view, { caseId });
    expect(view?.transactions).toHaveLength(1);
    const analysis = view?.case.analysis as { match: { matchedRef: string }; recommendation: { action: string } };
    expect(analysis.match.matchedRef).toBe("T:p-1");
    expect(analysis.recommendation.action).toBe("reimbursement_review");
  });

  it("deduplicates retried voice utterances within a session", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
    const a = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance: "I didn't make a $49 charge", utteranceKey: "k1" });
    const b = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance: "I didn't make a $49 charge", utteranceKey: "k1" });
    const bad = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: "vs_unknown", utterance: "hi", utteranceKey: "k2" });
    expect(a).toMatchObject({ ok: true, ref: "S1", duplicate: false });
    expect(b).toMatchObject({ ok: true, ref: "S1", duplicate: true });
    expect(bad).toEqual({ ok: false, error: "unknown or expired voice session" });
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.statements.map((s) => s.channel)).toEqual(["voice"]);
  });

  it("binds one Cartesia call to one voice session, and refuses rebinding", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    const s1 = await t.mutation(api.voice.createVoiceSession, { caseId });
    const s2 = await t.mutation(api.voice.createVoiceSession, { caseId });
    await expect(t.mutation(api.voice.bindVoiceCall, { sessionToken: s1.token, callId: "not-a-call" })).rejects.toThrow(/invalid Cartesia call ID/);
    await expect(t.mutation(api.voice.bindVoiceCall, { sessionToken: "vs_nope", callId: "ac_aaaaaaaaaa" })).rejects.toThrow(/unknown or expired/);
    expect(await t.mutation(api.voice.bindVoiceCall, { sessionToken: s1.token, callId: "ac_aaaaaaaaaa" })).toEqual({ ok: true });
    expect(await t.mutation(api.voice.bindVoiceCall, { sessionToken: s1.token, callId: "ac_aaaaaaaaaa" })).toEqual({ ok: true }); // retry is a no-op
    await expect(t.mutation(api.voice.bindVoiceCall, { sessionToken: s1.token, callId: "ac_bbbbbbbbbb" })).rejects.toThrow(/already bound to another call/);
    await expect(t.mutation(api.voice.bindVoiceCall, { sessionToken: s2.token, callId: "ac_aaaaaaaaaa" })).rejects.toThrow(/already bound to another voice session/);
  });

  it("records tool calls by call ID through the authenticated HTTP endpoint", async () => {
    process.env.VOICE_TOOL_SECRET = "test-secret";
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      const post = (body: unknown, auth = "Bearer test-secret") =>
        t.fetch("/voice/tools/record-statement", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

      expect((await post({ call_id: "ac_cccccccccc", utterance: "hi" }, "Bearer wrong")).status).toBe(401);
      const unbound = await post({ call_id: "ac_cccccccccc", utterance: "I didn't make a $49 charge" });
      expect(unbound.status).toBe(404);
      expect(await unbound.json()).toEqual({ error: "this call is not linked to a case (or its session expired)" });
      expect((await post({ call_id: "ac_cccccccccc", session_token: token, utterance: "x" })).status).toBe(400);

      await t.mutation(api.voice.bindVoiceCall, { sessionToken: token, callId: "ac_cccccccccc" });
      const ok = await post({ call_id: "ac_cccccccccc", utterance: "I didn't make a $49 charge" });
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body).toMatchObject({ recorded: "S1", duplicate: false, awaiting_interpretation: false });
      expect(body).not.toHaveProperty("recommended_action");
      const view = await t.query(api.cases.view, { caseId });
      expect(view?.statements.map((s) => [s.ref, s.channel])).toEqual([["S1", "voice"]]);
    } finally {
      delete process.env.VOICE_TOOL_SECRET;
    }
  });

  it("asks one question at a time, links answers to it, and never repeats a question more than twice", async () => {
    process.env.VOICE_TOOL_SECRET = "test-secret";
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const fields = { provider: "nessie" as const, kind: "purchase" as const, description: null, merchantId: null, status: "executed", medium: "balance" };
      await t.mutation(internal.cases.storeTransactions, {
        caseId,
        transactions: [
          { ...fields, ref: "T:g-1", externalId: "g-1", amount: 49, date: "2026-10-19", merchantName: "FCI Demo GiftCard Hub" },
          { ...fields, ref: "T:c-1", externalId: "c-1", amount: 49, date: "2026-10-20", merchantName: "FCI Demo Bean Coffee" },
        ],
        warnings: [],
      });
      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      await t.mutation(api.voice.bindVoiceCall, { sessionToken: token, callId: "ac_dddddddddd" });
      const say = async (utterance: string, question_id?: string | null) =>
        (await t.fetch("/voice/tools/record-statement", {
          method: "POST",
          headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: "ac_dddddddddd", utterance, ...(question_id ? { question_id } : {}) }),
        })).json() as Promise<{ recorded: string; duplicate: boolean; question_id: string | null; question: string | null; next_questions: string[]; end_call: boolean }>;

      const r1 = await say("There's a $49 charge I don't recognize");
      expect(r1.question).toMatch(/I found 2 payments that could match/);
      expect(r1.next_questions).toEqual([r1.question]);

      const r2 = await say("The gift card one, at GiftCard Hub", r1.question_id);
      expect(r2.question).toMatch(/did you give anyone a code/);

      const r3 = await say("Yes.", r2.question_id);
      expect(r3.recorded).toBe("S3");
      expect(r3.question).toBe("What did they tell you the code or details would be used for?");

      // Same words, different question: a new statement, not a duplicate.
      const r4 = await say("Yes.", r3.question_id);
      expect(r4).toMatchObject({ recorded: "S4", duplicate: false });
      // A retry of that call returns the same response.
      const retry = await say("Yes.", r3.question_id);
      expect(retry).toEqual({ ...r4, duplicate: true });
      // "Yes." does not answer an open question, so it is asked once more, then handed to a reviewer.
      expect(r4.question).toBe(r3.question);
      // Nothing left to ask: one wrap-up question, then the closing with end_call (live 2026-10-24:
      // a null question made the agent ask "anything else?" forever, and it waited for a goodbye).
      const r5 = await say("Okay.", r4.question_id);
      expect(r5).toMatchObject({ question: WRAP_UP_PROMPT, end_call: false });
      expect(r5.question_id).not.toBeNull();
      expect(await t.query(api.voice.sessionClosing, { sessionToken: token })).toBe(false);
      // An unknown or foreign question_id is ignored, not trusted.
      const r6 = await say("No, that's all", "not-a-real-id");
      expect(r6).toMatchObject({ recorded: "S6", question: CLOSING_MESSAGE, question_id: null, end_call: true });
      expect(await t.query(api.voice.sessionClosing, { sessionToken: token })).toBe(true);
      // Anything said after the closing gets the closing again, never another "anything else?".
      expect(await say("Oh, and thanks")).toMatchObject({ end_call: true, question: CLOSING_MESSAGE });

      const view = await t.query(api.cases.view, { caseId });
      const byRef = new Map(view!.statements.map((s) => [s.ref, s]));
      expect(byRef.get("S2")?.inResponseTo?.key).toBe("tentative:T:c-1");
      expect(byRef.get("S3")?.answer).toMatchObject({ key: "credentials", state: "answered", derived: { credentialSharing: "shared" } });
      expect(byRef.get("S4")?.inResponseTo?.key).toBe("code_purpose");
      expect((view?.case.analysis as { match: { matchedRef: string } }).match.matchedRef).toBe("T:g-1");
      expect(view?.activity.some((a) => a.kind === "question_handed_to_reviewer")).toBe(true);
    } finally {
      delete process.env.VOICE_TOOL_SECRET;
    }
  });

  it("asks a real question even when the live interpretation isn't ready, never an \"anything else?\" acknowledgement", async () => {
    vi.useFakeTimers();
    Object.assign(process.env, { VOICE_TOOL_SECRET: "test-secret", REASONING_PROVIDER: "openai-compatible", VOICE_INTERPRETATION_WAIT_MS: "0" });
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      const res = await t.fetch("/voice/tools/record-statement", {
        method: "POST",
        headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ session_token: token, utterance: "I didn't make a $49 charge" }),
      });
      const body = (await res.json()) as { awaiting_interpretation: boolean; question: string | null; question_id: string | null; end_call: boolean };
      expect(body).toMatchObject({ awaiting_interpretation: true, end_call: false });
      expect(body.question).toEqual(expect.any(String));
      expect(body.question_id).not.toBeNull();
      expect(body.question).not.toMatch(/anything else about that/i);
    } finally {
      for (const k of ["VOICE_TOOL_SECRET", "REASONING_PROVIDER", "VOICE_INTERPRETATION_WAIT_MS"]) delete process.env[k];
      vi.useRealTimers();
    }
  });

  it("never acknowledges instead of asking, and doesn't make short replies wait for the model", async () => {
    vi.useFakeTimers();
    Object.assign(process.env, { VOICE_TOOL_SECRET: "test-secret", REASONING_PROVIDER: "openai-compatible", VOICE_INTERPRETATION_WAIT_MS: "0" });
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      const say = async (utterance: string) =>
        (await t.fetch("/voice/tools/record-statement", {
          method: "POST",
          headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: token, utterance }),
        })).json() as Promise<{ awaiting_interpretation: boolean; question_id: string | null; question: string | null }>;

      // Live call 2026-10-24: every turn was an acknowledgement and no question was ever asked.
      const r1 = await say("Okay, so I had a transaction that I believe was fraudulent because I did not authorize it");
      expect(r1.awaiting_interpretation).toBe(true);
      expect(r1.question_id).not.toBeNull();
      const r2 = await say("It happened yesterday and it was billed to my account in the evening");
      expect(r2.awaiting_interpretation).toBe(true); // still not interpreted (wait is 0 here), but a question is asked
      expect(r2.question_id).not.toBeNull();
      const r3 = await say("No, I'm done.");
      expect(r3.awaiting_interpretation).toBe(false);
      const view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.activity.some((a) => a.kind === "asked_without_waiting")).toBe(true);
    } finally {
      for (const k of ["VOICE_TOOL_SECRET", "REASONING_PROVIDER", "VOICE_INTERPRETATION_WAIT_MS"]) delete process.env[k];
      vi.useRealTimers();
    }
  });

  it("gives model-proposed findings IDs that can't collide with rule-based ones", async () => {
    vi.useFakeTimers();
    process.env.REASONING_PROVIDER = "openai-compatible";
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(api.cases.submitStatement, { caseId, text: "I didn't make a $49 charge", clientEventId: "evt-00000001" });
      const s = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
      const finding = (text: string) => ({ id: "F1", text, category: "model_inference", evidenceRefs: ["S1"], status: "tentative", contradictions: [] });
      await t.mutation(internal.statements.applyInterpretation, {
        statementId: s._id,
        attemptId: s.currentAttemptId!,
        interpretation: { mode: "live", provider: "m", amounts: [49], dates: [], merchantTerms: [], authorization: "denies_authorization", credentialSharing: "unspecified", scamIndicators: [] },
        proposedFindings: [finding("first"), finding("second")],
        followUpQuestion: null,
      });
      const ids = ((await t.query(api.cases.view, { caseId }))!.case.analysis as { findings: { id: string }[] }).findings.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining(["F1", "S1-M1", "S1-M2"]));
    } finally {
      delete process.env.REASONING_PROVIDER;
      vi.useRealTimers();
    }
  });

  it("automatically approves a qualifying claim once, schedules a SIMULATED payout, and flags later doubt", async () => {
    vi.useFakeTimers(); // keeps the scheduled payout (a live Nessie write) from running
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const fields = { provider: "nessie" as const, kind: "purchase" as const, description: null, merchantId: null, status: "executed", medium: "balance" };
      const today = new Date().toISOString().slice(0, 10);
      await t.mutation(internal.cases.storeTransactions, {
        caseId,
        transactions: [
          { ...fields, ref: "T:g-1", externalId: "g-1", amount: 23, date: today, merchantName: "FCI Demo Corner Grocer" },
          { ...fields, ref: "T:v-1", externalId: "v-1", amount: 389, date: today, merchantName: "FCI Demo Volt Electronics Online" },
        ],
        warnings: [],
      });
      await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.", clientEventId: "evt-00000001" });
      // The customer's word alone is not enough (policy version 2): no evidence yet, no approval.
      let view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.decisions).toEqual([]);
      expect((view.case.autoApproval as { checks: { id: string; passed: boolean }[] }).checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([
        "payment_origin_supports_claim",
        "identity_check_clear",
        "fraud_risk_low",
      ]);

      // The evidence arrives: a payment-origin record that points away from the customer, a clean identity check, and a low risk score.
      await t.mutation(api.paymentOrigins.setSynthetic, { caseId, txnRef: "T:g-1", preset: "new_device_far_away" });
      await expect(t.mutation(api.paymentOrigins.setSynthetic, { caseId, txnRef: "T:not-on-case", preset: "new_device_far_away" })).rejects.toThrow(/not on this case/);
      await t.mutation(api.crsData.linkPersona, { caseId, personaId: "P01" });
      const crsRow = (suffix: string, product: string, field: string, value: string) => ({ ref: `X:crs:P01:k1:${suffix}`, provider: "crs", product, field, value, syntheticAssociation: true });
      await t.mutation(internal.crsData.storeIdentityEvidence, { caseId, personaId: "P01", rows: [crsRow("result", "transunion-identity-manager-basic", "verification_messages", "none returned (identity elements verified)")] });
      await t.mutation(internal.crsData.storeFraudEvidence, { caseId, personaId: "P01", rows: [crsRow("ff-score", "crs-fraud-finder-atdata", "risk_score", "11")] });
      await t.mutation(api.cases.submitStatement, { caseId, text: "That's all I have.", clientEventId: "evt-00000002" });
      view = (await t.query(api.cases.view, { caseId }))!;
      // The identity check is kept when the Fraud Finder result arrives (each product supersedes only its own rows).
      expect(view.providerEvidence.map((p) => p.product).sort()).toEqual(["crs-fraud-finder-atdata", "transunion-identity-manager-basic"]);
      expect(view.decisions).toHaveLength(1);
      expect(view.decisions[0]).toMatchObject({ txnRef: "T:g-1", amount: 23, outcome: "auto_approved", payout: { simulated: true, status: "pending" } });
      expect(view.activity.filter((a) => a.kind === "auto_approved")).toHaveLength(1);

      await t.mutation(internal.payoutData.recordPayout, { decisionId: view.decisions[0]!._id, result: { ok: true, depositId: "dep-1", reused: false } });
      await expect(t.mutation(api.payoutData.retryPayout, { decisionId: view.decisions[0]!._id })).rejects.toThrow(/not failed/);

      // A later contradiction doesn't reverse anything; it flags the approval for a person.
      await t.mutation(api.cases.submitStatement, { caseId, text: "Actually I paid for the $23 order myself", clientEventId: "evt-00000003" });
      view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.decisions[0]).toMatchObject({ payout: { status: "deposited", depositId: "dep-1" } });
      expect(view.decisions[0]?.needsReview?.reason).toMatch(/Facts changed after automatic approval/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not approve over the limit; the case shows which check failed", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      const txn = { provider: "nessie" as const, kind: "purchase" as const, description: null, merchantId: null, status: "executed", medium: "balance", ref: "T:v-1", externalId: "v-1", amount: 389, date: new Date().toISOString().slice(0, 10), merchantName: "FCI Demo Volt Electronics Online" };
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
      await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $389 purchase at Volt Electronics. I never shared my card or codes.", clientEventId: "evt-00000001" });
      const view = (await t.query(api.cases.view, { caseId }))!;
      expect(view.decisions).toEqual([]);
      const evaluation = view.case.autoApproval as { eligible: boolean; checks: { id: string; passed: boolean }[] };
      expect(evaluation.eligible).toBe(false);
      expect(evaluation.checks.filter((c) => !c.passed).map((c) => c.id)).toContain("amount_within_limit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a live result only from the statement's current attempt", async () => {
    vi.useFakeTimers();
    process.env.REASONING_PROVIDER = "openai-compatible";
    try {
      const t = convexTest(schema, modules);
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(api.cases.submitStatement, { caseId, text: "I didn't make a $49 charge", clientEventId: "evt-00000001" });
      const first = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
      expect(first.interpretationStatus).toBe("pending");
      const oldAttempt = first.currentAttemptId!;

      await t.mutation(api.statements.retryLive, { statementId: first._id });
      const interp = { mode: "live" as const, provider: "m", amounts: [49], dates: [], merchantTerms: [], authorization: "denies_authorization" as const, credentialSharing: "unspecified" as const, scamIndicators: [] };
      // The superseded attempt's late success and late failure are both discarded.
      await t.mutation(internal.statements.applyInterpretation, { statementId: first._id, attemptId: oldAttempt, interpretation: interp, proposedFindings: [], followUpQuestion: null });
      await t.mutation(internal.statements.markInterpretationFailed, { statementId: first._id, attemptId: oldAttempt, error: "timeout" });
      let s = (await t.query(api.cases.view, { caseId }))!.statements[0]!;
      expect(s.interpretationStatus).toBe("pending");
      expect(s.currentAttemptId).not.toBe(oldAttempt);

      await t.mutation(internal.statements.applyInterpretation, { statementId: first._id, attemptId: s.currentAttemptId!, interpretation: interp, proposedFindings: [], followUpQuestion: null });
      const view = (await t.query(api.cases.view, { caseId }))!;
      s = view.statements[0]!;
      expect(s.interpretationStatus).toBe("done");
      expect(view.activity.filter((a) => a.kind === "stale_result_discarded")).toHaveLength(2);
    } finally {
      delete process.env.REASONING_PROVIDER;
      vi.useRealTimers();
    }
  });

  it("removes card numbers and codes before storing or logging a statement", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "They took $389. My card is 4111 1111 1111 1111 and the code was 482913", clientEventId: "evt-00000001" });
    const view = (await t.query(api.cases.view, { caseId }))!;
    expect(view.statements[0]?.text).toBe("They took $389. My card is [REDACTED:card_number] and the code was [REDACTED:code]");
    expect(view.statements[0]?.redactions?.sort()).toEqual(["card_number", "code"]);
    expect(JSON.stringify(view)).not.toMatch(/4111|482913/);
  });

  it("links an auto-detected correction to the statement that gave that value, not a 'Yes.' in between", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "I got a bill for 19.99 I didn't make", clientEventId: "evt-00000001" });
    await t.mutation(api.cases.submitStatement, { caseId, text: "Yes.", clientEventId: "evt-00000002" });
    await t.mutation(api.cases.submitStatement, { caseId, text: "It was 24 dollars and 99 cents, not 19 dollars and 99 cents like I said", clientEventId: "evt-00000003" });
    const view = (await t.query(api.cases.view, { caseId }))!;
    const s3 = view.statements[2]!;
    expect(s3.correctsRef).toBe("S1");
    expect(s3.interpretation?.amounts).toEqual([24.99]);
    expect((view.case.analysis as { facts: { amounts: { value: number }[] } }).facts.amounts.map((a) => a.value)).toEqual([24.99]);
  });

  it("keeps the earlier version when a re-retrieved transaction changes", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    const txn = { ref: "T:p-1", provider: "nessie" as const, externalId: "p-1", kind: "purchase" as const, amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "Volt", status: "pending", medium: "balance" };
    await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [txn], warnings: [] });
    await t.mutation(internal.cases.storeTransactions, { caseId, transactions: [{ ...txn, status: "executed" }], warnings: [] });
    const view = (await t.query(api.cases.view, { caseId }))!;
    expect(view.transactions.map((x) => x.status)).toEqual(["executed"]);
    expect(view.history.transactions.map((x) => x.status)).toEqual(["pending"]);
  });
});

describe("CRS persistence", () => {
  it("only links published personas and keeps the token out of public queries", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await expect(t.mutation(api.crsData.linkPersona, { caseId, personaId: "P99" })).rejects.toThrow(/unknown CRS test persona/);
    await t.mutation(api.crsData.linkPersona, { caseId, personaId: "P12" });
    await t.mutation(internal.crsData.saveToken, { token: "jwt-secret", expiresAt: Date.now() + 60_000 });
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.case.crsPersonaId).toBe("P12");
    expect(JSON.stringify(view)).not.toContain("jwt-secret");
    expect(JSON.stringify(await t.query(api.system.integrationStatus, {}))).not.toContain("jwt-secret");
  });

  it("a failed login locks further logins until a human unlocks", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.crsData.lockLogin, { reason: "login HTTP 401" });
    expect((await t.query(internal.crsData.getAuth, {}))?.loginLockedAt).toBeTypeOf("number");
    await t.mutation(internal.crsData.unlockLogin, {});
    expect((await t.query(internal.crsData.getAuth, {}))?.loginLockedAt).toBeNull();
  });
});

describe("CRS persona re-linking", () => {
  it("supersedes evidence about the previously linked persona and keeps it as history", async () => {
    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.crsData.linkPersona, { caseId, personaId: "P12" });
    await t.mutation(internal.crsData.storeIdentityEvidence, {
      caseId, personaId: "P12",
      rows: [{ ref: "X:crs:P12:r1:result", provider: "crs", product: "p", field: "verification_messages", value: "1 message(s) returned", syntheticAssociation: true }],
    });
    expect((await t.query(api.cases.view, { caseId }))?.providerEvidence).toHaveLength(1);
    await t.mutation(api.crsData.linkPersona, { caseId, personaId: "P01" });
    const view = await t.query(api.cases.view, { caseId });
    expect(view?.providerEvidence).toHaveLength(0);
    expect(view?.history.providerEvidence.map((e) => e.supersededReason)).toEqual(["persona P12 replaced by P01"]);
    expect((view?.case.analysis as { findings: { category: string }[] }).findings.some((f) => f.category === "external_provider")).toBe(false);
  });
});

describe("demo personas (SYNTHETIC)", () => {
  const purchase = (externalId: string, amount: number, merchantName: string) => ({
    ref: `T:${externalId}`, externalId, provider: "nessie" as const, kind: "purchase" as const, amount, date: "2026-10-23",
    description: null, merchantId: `m-${externalId}`, merchantName, status: "completed", medium: "balance",
  });

  it("binds the persona's account and CRS identity on the backend, and refuses unknown or unconfigured personas", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("NESSIE_PERSONA_ACCOUNTS", "");
    await expect(t.mutation(api.personas.createForPersona, { personaId: "margaret" })).rejects.toThrow(/no Nessie account configured/);
    vi.stubEnv("NESSIE_PERSONA_ACCOUNTS", JSON.stringify({ margaret: "acct-margaret" }));
    try {
      await expect(t.mutation(api.personas.createForPersona, { personaId: "nobody" })).rejects.toThrow(/unknown demo persona/);
      const caseId = await t.mutation(api.personas.createForPersona, { personaId: "margaret" });
      const view = await t.query(api.cases.view, { caseId });
      expect(view?.case).toMatchObject({ nessieAccountId: "acct-margaret", crsPersonaId: "P01", demoPersonaId: "margaret", bankFetch: { status: "never" } });
      expect(view?.case.customerLabel).toMatch(/Margaret Okafor \(SYNTHETIC demo persona/);
      expect(view?.activity.some((a) => a.kind === "case_created" && /Expected outcome/.test(a.message))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("attaches the persona's payment-origin records on retrieval, without overwriting one already set", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("NESSIE_PERSONA_ACCOUNTS", JSON.stringify({ margaret: "acct-margaret" }));
    try {
      const caseId = await t.mutation(api.personas.createForPersona, { personaId: "margaret" });
      // A reviewer already set the coffee purchase's origin on another case: it stays.
      await t.run((ctx) => ctx.db.insert("paymentOrigins", { txnExternalId: "coffee-1", channel: "online_banking", device: "new_device", twoFactor: "failed", city: "X", state: "TX", synthetic: true, preset: "new_device_far_away", setAt: 1 }));
      const transactions = [purchase("games-1", 58, "FCI Demo PixelPlay Games"), purchase("coffee-1", 7, "FCI Demo Daybreak Coffee"), purchase("other-1", 999, "Someone Else")];
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions, warnings: [] });
      const view = await t.query(api.cases.view, { caseId });
      const byRef = new Map(view?.paymentOrigins.map((o) => [o.txnRef, o]));
      expect(byRef.get("T:games-1")).toMatchObject({ device: "new_device", twoFactor: "not_used", city: "Las Vegas", state: "NV", preset: "persona:margaret:games", synthetic: true });
      expect(byRef.get("T:coffee-1")?.preset).toBe("new_device_far_away");
      expect(byRef.has("T:other-1")).toBe(false);

      // A plain case gets no automatic origins.
      const plain = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(internal.cases.storeTransactions, { caseId: plain, transactions: [purchase("plain-1", 58, "FCI Demo PixelPlay Games")], warnings: [] });
      expect((await t.query(api.cases.view, { caseId: plain }))?.paymentOrigins).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

const newTest = () => convexTest(schema, modules);
type TestConvex = ReturnType<typeof newTest>;

describe("removing a case", () => {
  const TABLES = ["statements", "transactions", "providerEvidence", "activity", "processedEvents", "reimbursementDecisions", "caseProposals", "intakeTurns", "voiceSessions"] as const;

  /** A case with a row in every table that holds case data, through the real entry points where they exist. */
  async function populatedCase(t: TestConvex) {
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $23 purchase", clientEventId: "evt-rm-0001" });
    await t.mutation(internal.cases.storeTransactions, {
      caseId,
      transactions: [{ ref: "T:rm-1", externalId: "rm-1", provider: "nessie", kind: "purchase", amount: 23, date: "2026-10-22", description: null, merchantId: "m", merchantName: "Shop", status: "completed", medium: "balance" }],
      warnings: [],
    });
    await t.mutation(internal.crsData.storeIdentityEvidence, { caseId, personaId: "P01", rows: [{ ref: "X:crs:P01:k:result", provider: "crs", product: "transunion-identity-manager-basic", field: "verification_messages", value: "none returned", syntheticAssociation: true }] });
    await t.mutation(api.voice.createVoiceSession, { caseId });
    await t.run(async (ctx) => {
      const session = (await ctx.db.query("voiceSessions").withIndex("by_case", (q) => q.eq("caseId", caseId)).first())!;
      await ctx.db.insert("intakeTurns", { caseId, sessionId: session._id, questionKey: "initiation", kind: "initiation", text: "q", issuedAt: 1, analysisVersion: 1 });
      await ctx.db.insert("reimbursementDecisions", { caseId, txnRef: "T:rm-1", amount: 23, policy: "AUTO-1@test", outcome: "auto_approved", checks: [], decidedAt: 1, payout: { simulated: true, status: "pending" } });
      await ctx.db.insert("caseProposals", { caseId, signature: "s", status: "pending", trigger: "manual", input: {}, requestedAt: 1 });
      await ctx.db.insert("paymentOrigins", { txnExternalId: "rm-1", channel: "online_banking", device: "new_device", twoFactor: "not_used", city: "X", state: "TX", synthetic: true, preset: "new_device_far_away", setAt: 1 });
    });
    return caseId;
  }
  const countRows = (t: TestConvex, caseId: Id<"cases">) =>
    t.run(async (ctx) => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, (await ctx.db.query(table).withIndex("by_case", (q) => q.eq("caseId", caseId)).collect()).length] as const))));

  it("deletes the case and every row recorded for it, leaves other cases alone, and keeps payment-origin records", async () => {
    const t = newTest();
    const doomed = await populatedCase(t);
    const kept = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId: kept, text: "Another claim", clientEventId: "evt-rm-0002" });
    expect(Object.values(await countRows(t, doomed)).every((n) => n > 0)).toBe(true);

    expect(await t.mutation(api.cases.remove, { caseId: doomed })).toEqual({ removed: true });
    expect(await countRows(t, doomed)).toEqual(Object.fromEntries(TABLES.map((x) => [x, 0])));
    expect(await t.query(api.cases.view, { caseId: doomed })).toBeNull();
    expect((await t.query(api.cases.list, {})).map((c) => c._id)).toEqual([kept]);
    expect((await t.query(api.cases.view, { caseId: kept }))?.statements).toHaveLength(1);
    // Origins belong to the Nessie transaction, which later cases reuse.
    expect(await t.run((ctx) => ctx.db.query("paymentOrigins").withIndex("by_txn", (q) => q.eq("txnExternalId", "rm-1")).unique())).not.toBeNull();
    // Removing again is a no-op.
    expect(await t.mutation(api.cases.remove, { caseId: doomed })).toEqual({ removed: false });
  });

  it("work still in flight for a removed case writes nothing", async () => {
    const t = newTest();
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.remove, { caseId });
    await t.mutation(internal.crsData.recordCrsError, { caseId, error: "late" });
    await t.mutation(internal.personas.logSetup, { caseId, kind: "persona_setup_done", message: "late" });
    await expect(t.mutation(internal.cases.storeTransactions, { caseId, transactions: [], warnings: [] })).rejects.toThrow();
    await expect(t.mutation(api.cases.submitStatement, { caseId, text: "late", clientEventId: "evt-rm-0003" })).rejects.toThrow(/case not found/);
    await expect(t.mutation(api.voice.createVoiceSession, { caseId })).rejects.toThrow(/case not found/);
    expect(Object.values(await countRows(t, caseId)).every((n) => n === 0)).toBe(true);
  });

  it("finishes a large case in scheduled batches", async () => {
    vi.useFakeTimers();
    try {
      const t = newTest();
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.run(async (ctx) => {
        for (let i = 0; i < 1200; i++) await ctx.db.insert("activity", { caseId, at: i, actor: "test", kind: "note", message: "x" });
      });
      await t.mutation(api.cases.remove, { caseId });
      expect((await countRows(t, caseId)).activity).toBeGreaterThan(0);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await countRows(t, caseId)).activity).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists what the call page needs to pick a case to call back about", async () => {
    const t = newTest();
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "There's a charge I don't recognize", clientEventId: "evt-rm-0004" });
    const [row] = await t.query(api.cases.list, {});
    expect(row).toMatchObject({ _id: caseId, demoPersonaId: null, customerLabel: expect.stringMatching(/synthetic/i), stage: expect.any(String) });
    expect(typeof row!.openCustomerQuestions).toBe("number");
  });
});

describe("call-backs (live 2026-10-24)", () => {
  const ledger = [{ ref: "T:cb-1", externalId: "cb-1", provider: "nessie" as const, kind: "purchase" as const, amount: 23, date: "2026-10-22", description: null, merchantId: "m-cb", merchantName: "FCI Demo Corner Grocer", status: "completed", medium: "balance" }];

  it("doesn't flag an automatic approval for review just because a new statement is still being interpreted", async () => {
    vi.useFakeTimers();
    try {
      const t = newTest();
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: ledger, warnings: [] });
      await t.run(async (ctx) => {
        await ctx.db.insert("reimbursementDecisions", { caseId, txnRef: "T:cb-1", amount: 23, policy: "AUTO-1@test", outcome: "auto_approved", checks: [], decidedAt: 1, payout: { simulated: true, status: "deposited" } });
      });
      process.env.REASONING_PROVIDER = "openai-compatible";
      // A call-back statement goes to the live model; while it is pending, "all_statements_interpreted" fails.
      await t.mutation(api.cases.submitStatement, { caseId, text: "I'm calling back about the $23 charge", clientEventId: "evt-cb-0001" });
      const pending = await t.run(async (ctx) => ({
        decision: (await ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", caseId)).first())!,
        statement: (await ctx.db.query("statements").withIndex("by_case", (q) => q.eq("caseId", caseId)).first())!,
      }));
      expect(pending.statement.interpretationStatus).toBe("pending");
      expect(pending.decision.needsReview).toBeUndefined();

      // A FAILED interpretation is a real gap, so it does flag the approval.
      await t.mutation(internal.statements.markInterpretationFailed, { statementId: pending.statement._id, attemptId: pending.statement.currentAttemptId!, error: "HTTP 500" });
      const after = await t.run((ctx) => ctx.db.query("reimbursementDecisions").withIndex("by_case", (q) => q.eq("caseId", caseId)).first());
      expect(after?.needsReview?.reason).toMatch(/all_statements_interpreted/);
    } finally {
      delete process.env.REASONING_PROVIDER;
      vi.useRealTimers();
    }
  });

  it("on a call about a case that already has everything, says so before the wrap-up, then closes", async () => {
    process.env.VOICE_TOOL_SECRET = "test-secret";
    try {
      const t = newTest();
      const caseId = await t.mutation(api.cases.createSynthetic, {});
      await t.mutation(internal.cases.storeTransactions, { caseId, transactions: ledger, warnings: [] });
      await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $23 purchase at Corner Grocer. I never shared my card or codes.", clientEventId: "evt-cb-0002" });
      const questions = ((await t.query(api.cases.view, { caseId }))!.case.analysis as { questions: { audience: string }[] }).questions;
      expect(questions.filter((q) => q.audience === "customer")).toEqual([]);

      const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
      const say = async (utterance: string) =>
        (await t.fetch("/voice/tools/record-statement", {
          method: "POST",
          headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" },
          body: JSON.stringify({ session_token: token, utterance }),
        })).json() as Promise<{ question: string | null; end_call: boolean }>;
      expect(await say("Hi, I'm calling back about the charge I reported")).toMatchObject({ question: WRAP_UP_COMPLETE_PROMPT, end_call: false });
      expect(await say("No, that's all")).toMatchObject({ question: CLOSING_MESSAGE, end_call: true });
    } finally {
      delete process.env.VOICE_TOOL_SECRET;
    }
  });
});

describe("cases stored with an older analysis shape (live 2026-10-24)", () => {
  it("still load in the claims queue: missing facts.txnDecisions/answers and question keys are filled in", async () => {
    const t = newTest();
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(internal.cases.storeTransactions, {
      caseId,
      transactions: [{ ref: "T:old-1", externalId: "old-1", provider: "nessie", kind: "purchase", amount: 389, date: "2026-10-17", description: null, merchantId: "m-old", merchantName: "FCI Demo Volt Electronics Online", status: "completed", medium: "balance" }],
      warnings: [],
    });
    await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $389 purchase at Volt Electronics", clientEventId: "evt-old-0001" });
    // Strip what was added to the stored analysis during 2026-10-24, as on the oldest dev cases.
    await t.run(async (ctx) => {
      const c = (await ctx.db.get(caseId))!;
      const a = JSON.parse(JSON.stringify(c.analysis));
      expect(a.match.matchedRef).toBe("T:old-1"); // the crash needs a matched payment
      delete a.facts.txnDecisions;
      delete a.facts.answers;
      for (const q of a.questions) {
        delete q.key;
        delete q.audience;
        delete q.priority;
      }
      await ctx.db.patch(caseId, { analysis: a });
    });
    const rows = await t.query(api.review.queue, {});
    expect(rows.map((r) => r._id)).toContain(caseId);
  });
});

describe("Claim suite runner and deployment reset", () => {
  it("queues one run per persona, skips personas already running, and refuses unknown personas", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.suite.start, { personaIds: ["nobody"] })).rejects.toThrow(/unknown demo persona/);
    expect(await t.mutation(api.suite.start, { personaIds: ["margaret", "daniel"] })).toEqual({ queued: 2, skipped: 0 });
    expect(await t.mutation(api.suite.start, { personaIds: ["margaret"] })).toEqual({ queued: 0, skipped: 1 });
    const rows = await t.query(api.suite.results, {});
    expect(rows.find((r) => r.persona.id === "margaret")?.run?.status).toBe("queued");
    expect(rows.find((r) => r.persona.id === "grace")?.run).toBeNull();
    expect(rows.find((r) => r.persona.id === "daniel")?.persona.expected.failingChecks).toEqual(["no_prior_payments_to_merchant"]);
  });

  it("reset deletes every row in every table except the CRS login state", async () => {
    const { RESET_TABLES, KEPT_TABLES } = await import("../convex/admin");
    expect([...RESET_TABLES, ...KEPT_TABLES].sort()).toEqual(Object.keys(schema.tables).sort());

    const t = convexTest(schema, modules);
    const caseId = await t.mutation(api.cases.createSynthetic, {});
    await t.mutation(api.cases.submitStatement, { caseId, text: "I did not make the $58 charge", clientEventId: "evt-00000001" });
    await t.mutation(api.suite.start, { personaIds: ["grace"] });
    await t.run((ctx) => ctx.db.insert("providerAuth", { provider: "crs", loginLockedAt: 1, loginLockReason: "test" }));

    const r = await t.mutation(internal.admin.resetAll, { confirm: "delete every row" });
    expect(r.done).toBe(true);
    const counts = await t.run(async (ctx) => Object.fromEntries(await Promise.all([...RESET_TABLES, ...KEPT_TABLES].map(async (n) => [n, (await ctx.db.query(n).collect()).length]))));
    for (const n of RESET_TABLES) expect(counts[n], n).toBe(0);
    expect(counts.providerAuth).toBe(1);
  });
});
