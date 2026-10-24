import { Suspense } from "react";
import { ClaimsQueue } from "@/components/review/ClaimsQueue";

export default function ReviewQueuePage() {
  // ClaimsQueue reads ?case= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<main className="ws-main"><p className="ws-muted">Loading cases…</p></main>}>
      <ClaimsQueue />
    </Suspense>
  );
}
