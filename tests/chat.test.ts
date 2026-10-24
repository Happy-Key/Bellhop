// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");
const fields = { provider: "nessie" as const, kind: "purchase" as const, description: null, merchantId: null, status: "executed", medium: "balance" };
const records = [
  { ...fields, ref: "T:g-1", externalId: "g-1", amount: 49, date: "2026-10-19", merchantName: "FCI Demo GiftCard Hub" },
  { ...fields, ref: "T:c-1", externalId: "c-1", amount: 12.5, date: "2026-10-20", merchantName: "FCI Demo Bean Coffee" },
];
const id = (n: number) => `m${String(n).padStart(8, "0")}`;

async function caseWithRecords() {
  const t = convexTest(schema, modules);
  const caseId = await t.mutation(api.cases.createSynthetic, {});
  await t.mutation(internal.cases.storeTransactions, { caseId, transactions: records, warnings: [] });
  return { t, caseId };
}

describe("customer text chat", () => {
  it("records typed messages like a call's utterances: text channel, linked to the question asked, retries recorded once", async () => {
    const { t, caseId } = await caseWithRecords();
    const s = await t.mutation(api.chat.startChat, { caseId });
    expect(s).toMatchObject({ opening: null, reported: false });

    const r1 = await t.action(api.chat.send, { sessionToken: s.token, text: "There's a $49 charge from GiftCard Hub I don't recognize", messageId: id(1) });
    expect(r1).toMatchObject({ recorded: "S1", duplicate: false });
    expect(r1.question).toEqual(expect.any(String));

    const r2 = await t.action(api.chat.send, { sessionToken: s.token, text: "No, I didn't make it.", messageId: id(2), questionId: r1.question_id! });
    expect(r2.recorded).toBe("S2");
    const retry = await t.action(api.chat.send, { sessionToken: s.token, text: "No, I didn't make it.", messageId: id(2), questionId: r1.question_id! });
    expect(retry).toEqual({ ...r2, duplicate: true });

    const view = (await t.query(api.cases.view, { caseId }))!;
    expect(view.statements.map((x) => [x.ref, x.channel])).toEqual([["S1", "text"], ["S2", "text"]]);
    expect(view.statements[1]!.inResponseTo?.text).toBe(r1.question);
    expect(view.activity.some((a) => a.kind === "chat_session_created")).toBe(true);
    await expect(t.action(api.chat.send, { sessionToken: "vs_nope", text: "hi", messageId: id(3) })).rejects.toThrow(/expired/);
  });

  it("on an existing case, lists what the bank is waiting for, opens with a reviewer's question and marks it answered", async () => {
    const { t, caseId } = await caseWithRecords();
    const first = await t.mutation(api.chat.startChat, { caseId });
    await t.action(api.chat.send, { sessionToken: first.token, text: "There's a $49 charge from GiftCard Hub I don't recognize", messageId: id(1) });

    const qid = await t.mutation(api.reviewerQuestions.ask, { caseId, text: "Do you still have the card?" });
    const waiting = await t.query(api.chat.waitingQuestions, { caseId });
    expect(waiting[0]).toMatchObject({ source: "reviewer", text: "Do you still have the card?" });
    expect(waiting.length).toBeGreaterThan(1); // the rules' questions too, since no model is on

    const back = await t.mutation(api.chat.startChat, { caseId });
    expect(back).toMatchObject({ reported: true, opening: { text: "Do you still have the card?" } });
    const r = await t.action(api.chat.send, { sessionToken: back.token, text: "Yes, it's in my wallet.", messageId: id(2), questionId: back.opening!.questionId });

    const asked = await t.query(api.reviewerQuestions.forCase, { caseId });
    expect(asked.find((q) => q._id === qid)).toMatchObject({ answeredByRef: r.recorded });
    expect((await t.query(api.chat.waitingQuestions, { caseId })).some((q) => q.source === "reviewer")).toBe(false);
    const view = (await t.query(api.cases.view, { caseId }))!;
    expect(view.statements.find((x) => x.ref === r.recorded)?.inResponseTo).toMatchObject({ kind: "reviewer_question", text: "Do you still have the card?" });
  });

  it("asks a reviewer's question first on a voice call too, and a withdrawn one not at all", async () => {
    const { t, caseId } = await caseWithRecords();
    const { token } = await t.mutation(api.voice.createVoiceSession, { caseId });
    const say = async (utterance: string, key: string) => {
      const r = await t.mutation(internal.voice.recordVoiceUtterance, { sessionToken: token, utterance, utteranceKey: key });
      if (!r.ok) throw new Error("not recorded");
      return t.mutation(internal.voice.issueVoiceQuestion, { sessionId: r.sessionId, idempotencyKey: r.idempotencyKey, ref: r.ref, duplicate: false, awaitingInterpretation: false });
    };
    const keep = await t.mutation(api.reviewerQuestions.ask, { caseId, text: "Where were you on October 19?" });
    const drop = await t.mutation(api.reviewerQuestions.ask, { caseId, text: "Withdrawn question" });
    await t.mutation(api.reviewerQuestions.withdraw, { questionId: drop });
    expect((await say("There's a $49 charge from GiftCard Hub", "k1")).question).toBe("Where were you on October 19?");
    expect(keep).toBeTruthy();
    await expect(t.mutation(api.reviewerQuestions.ask, { caseId, text: "   " })).rejects.toThrow(/empty/);
  });
});
