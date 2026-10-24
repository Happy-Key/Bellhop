import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./review.css";

export const metadata: Metadata = {
  title: "Bellhop · Claims",
  description: "Bank-side review of fraud claims.",
};

export default function ReviewLayout({ children }: { children: ReactNode }) {
  return <div className="ws">{children}</div>;
}
