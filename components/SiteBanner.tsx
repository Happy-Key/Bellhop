"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Customers (/call) see a short demo notice; bank staff see the full prototype disclaimer. */
export function SiteBanner() {
  const pathname = usePathname();
  // The claims workstation (/review) carries its own prototype notice in its top bar.
  if (pathname === "/review" || pathname.startsWith("/review/")) return null;
  if (pathname === "/call" || pathname.startsWith("/call/")) {
    return (
      <header className="banner">
        <strong>Demo Bank fraud support</strong> — prototype. Use made-up details only; this demo uses synthetic accounts.
      </header>
    );
  }
  return (
    <header className="banner">
      <strong>Fraud Claims Investigator</strong> — hackathon prototype. All customer data is SYNTHETIC. Recommendations
      are drafts for human review; nothing here moves money or approves reimbursement.{" "}
      <Link href="/review">Claims workstation</Link> · <Link href="/call">Customer call view</Link>
    </header>
  );
}
