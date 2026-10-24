import { beforeEach, describe, expect, it } from "vitest";
import { aggregateFacts } from "@/lib/domain/facts";
import { matchTransactions } from "@/lib/domain/matching";
import { LEDGER, resetStatements, stmt, txn } from "./helpers/build";

const match = (...texts: string[]) => matchTransactions(aggregateFacts(texts.map((t) => stmt(t))), LEDGER);

describe("deterministic matching", () => {
  beforeEach(resetStatements);

  it("declares a clear match for a unique exact amount", () => {
    const r = match("I did not make the $389 purchase");
    expect(r.outcome).toBe("clear");
    expect(r.matchedRef).toBe("T:bbb222");
  });

  it("asks for clarification when several transactions share the amount", () => {
    const r = match("There's a $49 charge I don't recognize");
    expect(r.outcome).toBe("ambiguous");
    expect(r.matchedRef).toBeNull();
    expect(r.candidates.map((c) => c.txnRef).sort()).toEqual(["T:ccc333", "T:ddd444"]);
  });

  it("uses a reported merchant to narrow ambiguous candidates", () => {
    const r = match("There's a $49 charge at GiftCard Hub I don't recognize");
    expect(r.outcome).toBe("clear");
    expect(r.matchedRef).toBe("T:ccc333");
    expect(r.excluded).toEqual([{ txnRef: "T:ddd444", reason: "inconsistent with reported merchant" }]);
  });

  it("uses a reported date to narrow ambiguous candidates", () => {
    const ledger = [txn("a1", 49, "2026-10-01", "Shop A"), txn("b2", 49, "2026-10-20", "Shop B")];
    const r = matchTransactions(aggregateFacts([stmt("A $49 charge on 2026-10-20 that I did not make")]), ledger);
    expect(r.outcome).toBe("clear");
    expect(r.matchedRef).toBe("T:b2");
  });

  it("stays ambiguous when dates are within posting tolerance of both candidates", () => {
    const r = match("A $49 charge on 2026-10-20 that I did not make");
    expect(r.outcome).toBe("ambiguous");
  });

  it("reports no match when the amount matches nothing", () => {
    expect(match("a $77 charge I didn't make").outcome).toBe("no_match");
  });

  it("is tentative, not clear, when the date contradicts the only amount match", () => {
    const r = match("$389 on 2026-09-01 that I did not authorize");
    expect(r.outcome).toBe("tentative");
    expect(r.matchedRef).toBeNull();
    expect(r.candidates[0]?.contradictions[0]).toMatch(/days from reported/);
  });

  it("treats whole-dollar record amounts as approximate only", () => {
    const facts = aggregateFacts([stmt("I didn't make a $18.06 charge")]);
    const r = matchTransactions(facts, [txn("fff666", 18, "2026-10-20", "Somewhere")]);
    expect(r.outcome).toBe("tentative");
  });

  it("needs facts and transactions", () => {
    expect(match("something is wrong with my account").outcome).toBe("insufficient_facts");
    expect(matchTransactions(aggregateFacts([stmt("$389 charge")]), []).outcome).toBe("no_transactions");
  });
});
