import { CaseDashboard } from "@/components/CaseDashboard";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <CaseDashboard caseId={caseId} />;
}
