import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fraud Claims Investigator (prototype)",
  description: "Evidence-linked fraud claim investigation prototype. Synthetic data only.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="banner">
          <strong>Fraud Claims Investigator</strong> — hackathon prototype. All customer data is SYNTHETIC. Recommendations
          are drafts for human review; nothing here moves money or approves reimbursement.
        </header>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
