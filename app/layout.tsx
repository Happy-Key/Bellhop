import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { SiteBanner } from "@/components/SiteBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fraud Claims Investigator (prototype)",
  description: "Evidence-linked fraud claim investigation prototype. Synthetic data only.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteBanner />
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
