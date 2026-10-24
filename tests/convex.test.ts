// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

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
    const a = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance: "I didn't make a $49 charge", idempotencyKey: "voice:k1" });
    const b = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance: "I didn't make a $49 charge", idempotencyKey: "voice:k1" });
    const bad = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: "vs_unknown", utterance: "hi", idempotencyKey: "voice:k2" });
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
      expect(await ok.json()).toMatchObject({ recorded: "S1", duplicate: false });
      const view = await t.query(api.cases.view, { caseId });
      expect(view?.statements.map((s) => [s.ref, s.channel])).toEqual([["S1", "voice"]]);
    } finally {
      delete process.env.VOICE_TOOL_SECRET;
    }
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
  it("removes evidence about the previously linked persona", async () => {
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
    expect((view?.case.analysis as { findings: { category: string }[] }).findings.some((f) => f.category === "external_provider")).toBe(false);
  });
});
