import { CaseReview } from "@/components/review/CaseReview";

export default async function CaseReviewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseReview caseId={caseId} />;
}
