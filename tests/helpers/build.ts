import { interpretStatementScripted } from "@/lib/domain/interpret";
import type { Statement, TransactionEvidence } from "@/lib/domain/schemas";

export const NOW = Date.UTC(2026, 9, 23, 18, 0, 0); // 2026-10-23T18:00Z

let n = 0;
export function stmt(text: string, opts: { correctsRef?: string; at?: number } = {}): Statement {
  n++;
  const receivedAt = opts.at ?? NOW + n * 1000;
  return {
    ref: `S${n}`,
    text,
    channel: "text",
    receivedAt,
    ...(opts.correctsRef ? { correctsRef: opts.correctsRef } : {}),
    interpretation: interpretStatementScripted(text, receivedAt),
  };
}
export function resetStatements() {
  n = 0;
}

export function txn(id: string, amount: number, date: string, merchantName: string): TransactionEvidence {
  return {
    ref: `T:${id}`, provider: "nessie", externalId: id, kind: "purchase", amount, date,
    description: null, merchantId: `m-${id}`, merchantName, status: "executed", medium: "balance",
  };
}

export const LEDGER: TransactionEvidence[] = [
  txn("aaa111", 64, "2026-10-14", "FCI Demo Corner Grocer"),
  txn("bbb222", 389, "2026-10-17", "FCI Demo Volt Electronics Online"),
  txn("ccc333", 49, "2026-10-19", "FCI Demo GiftCard Hub"),
  txn("ddd444", 49, "2026-10-20", "FCI Demo Bean Coffee"),
  txn("eee555", 23, "2026-10-22", "FCI Demo Corner Grocer"),
];
