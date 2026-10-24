import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";

/** What the case workspace renders: the live `cases.view` result, or a demo case built in the same shape. */
export type CaseView = NonNullable<FunctionReturnType<typeof api.cases.view>>;
export type ViewStatement = CaseView["statements"][number];
export type ViewTransaction = CaseView["transactions"][number];
export type ViewActivity = CaseView["activity"][number];

/** A review action taken in the demo. Kept in browser memory only; never sent anywhere. */
export interface DemoReviewEvent {
  id: string;
  at: number;
  action: "accept" | "request_info" | "return" | "escalate" | "override";
  stepKey: string | null;
  reason: string;
}
