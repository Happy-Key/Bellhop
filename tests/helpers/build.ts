import { interpretStatementScripted } from "@/lib/domain/interpret";
import { interpretAnswer, relatedRefFromKey } from "@/lib/domain/answers";
import type { AskedQuestion, Statement, TransactionEvidence } from "@/lib/domain/schemas";

export const NOW = Date.UTC(2026, 9, 23, 18, 0, 0); // 2026-10-23T18:00Z

let n = 0;
/** A scripted-interpreted statement; with `replyTo`, it is read as an answer to that question (as recordStatement does). */
export function stmt(text: string, opts: { correctsRef?: string; at?: number; replyTo?: AskedQuestion } = {}): Statement {
  n++;
  const receivedAt = opts.at ?? NOW + n * 1000;
  const answer = interpretAnswer(text, opts.replyTo, opts.replyTo ? relatedRefFromKey(opts.replyTo.key) : undefined);
  return {
    ref: `S${n}`,
    text,
    channel: "text",
    receivedAt,
    ...(opts.correctsRef ? { correctsRef: opts.correctsRef } : {}),
    interpretation: interpretStatementScripted(text, receivedAt),
    ...(opts.replyTo ? { inResponseTo: opts.replyTo } : {}),
    ...(answer ? { answer } : {}),
  };
}

/** The question a statement replies to, built from an analysis question. */
export const replyTo = (q: { key: string; kind: string; text: string } | undefined): AskedQuestion => {
  if (!q) throw new Error("expected the analysis to ask this question");
  return { key: q.key, kind: q.kind, text: q.text };
};
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
