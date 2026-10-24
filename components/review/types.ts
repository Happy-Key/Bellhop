import type { MatchCandidate } from "@/lib/domain/matching";

export type { CaseView, ViewActivity, ViewStatement, ViewTransaction } from "@/lib/review/types";

/** A bank record the matcher put forward for this case. */
export interface Payment {
  ref: string;
  amount: number;
  date: string | null;
  merchant: string | null;
  status: string | null;
  matched: boolean;
  candidate: MatchCandidate | null;
}
