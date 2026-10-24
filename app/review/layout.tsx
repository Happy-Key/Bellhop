import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WorkstationBar } from "@/components/review/WorkstationBar";
import "./review.css";

export const metadata: Metadata = {
  title: "Claims workstation (prototype)",
  description: "Bank-side review of synthetic fraud-claim intake. Drafts for human review only.",
};

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ws">
      <WorkstationBar />
      {children}
    </div>
  );
}
