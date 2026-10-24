/** Convex validators mirroring lib/domain/schemas.ts (zod remains the source of runtime validation for external data). */
import { v } from "convex/values";

export const channel = v.union(v.literal("text"), v.literal("voice"));

export const interpretation = v.object({
  mode: v.union(v.literal("scripted"), v.literal("live")),
  provider: v.string(),
  amounts: v.array(v.number()),
  dates: v.array(v.string()),
  merchantTerms: v.array(v.string()),
  authorization: v.union(
    v.literal("denies_authorization"),
    v.literal("authorized_induced"),
    v.literal("authorized"),
    v.literal("unspecified"),
  ),
  credentialSharing: v.union(v.literal("shared"), v.literal("not_shared"), v.literal("unspecified")),
  scamIndicators: v.array(v.string()),
});

export const bankFetch = v.union(
  v.object({ status: v.literal("never") }),
  v.object({ status: v.literal("ok"), at: v.number(), count: v.number() }),
  v.object({ status: v.literal("error"), at: v.number(), error: v.string() }),
);

export const transactionFields = {
  ref: v.string(),
  provider: v.literal("nessie"),
  externalId: v.string(),
  kind: v.union(v.literal("purchase"), v.literal("withdrawal"), v.literal("transfer"), v.literal("deposit")),
  amount: v.number(),
  date: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
  merchantId: v.union(v.string(), v.null()),
  merchantName: v.union(v.string(), v.null()),
  status: v.union(v.string(), v.null()),
  medium: v.union(v.string(), v.null()),
};
