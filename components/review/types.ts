import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import type { MatchCandidate } from "@/lib/domain/matching";

export type CaseView = NonNullable<FunctionReturnType<typeof api.cases.view>>;

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
