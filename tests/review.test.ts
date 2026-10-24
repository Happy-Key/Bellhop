// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.*s");

describe("claims queue query", () => {
  it("projects each case's triage, report time, and matched payment without changing anything", async () => {
    const t = convexTest(schema, modules);
    const empty = await t.mutation(api.cases.createSynthetic, {});
    const claim = await t.mutation(api.cases.submitStatement, {
      caseId: await t.mutation(api.cases.createSynthetic, {}),
      text: "I did not make the $389 purchase at Volt Electronics",
      clientEventId: "evt-00000001",
    });
    expect(claim.ref).toBe("S1");

    let queue = await t.query(api.review.queue, {});
    expect(queue).toHaveLength(2);
    const byId = new Map(queue.map((c) => [c._id, c]));
    expect(byId.get(empty)).toMatchObject({ statementCount: 0, reportedAt: null, triage: { attention: "no_report" } });
    const reported = queue.find((c) => c._id !== empty)!;
    expect(reported).toMatchObject({ statementCount: 1, channels: ["text"], bankFetchStatus: "never", matched: null, reported: { amount: 389 } });
    expect(reported.reportedAt).toEqual(expect.any(Number));
    expect(reported.triage.steps[0]?.key).toBe("retrieve_bank_records");

    const txn = { ref: "T:p-1", provider: "nessie" as const, externalId: "p-1", kind: "purchase" as const, amount: 389, date: "2026-10-17", description: null, merchantId: null, merchantName: "FCI Demo Volt Electronics Online", status: "executed", medium: "balance" };
    await t.mutation(internal.cases.storeTransactions, { caseId: reported._id, transactions: [txn], warnings: [] });
    queue = await t.query(api.review.queue, {});
    const after = queue.find((c) => c._id === reported._id)!;
    expect(after.matched).toEqual({ ref: "T:p-1", amount: 389, date: "2026-10-17", merchant: "FCI Demo Volt Electronics Online" });
    expect(after.triage.attention).toBe("reviewer");
    expect(after.lastActivity?.message).toMatch(/Nessie retrieval/);
  });
});
