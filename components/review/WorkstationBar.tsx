"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkstationBar() {
  const pathname = usePathname();
  const inDemo = pathname === "/review/demo";
  const inQueue = !inDemo && (pathname === "/review" || pathname.startsWith("/review/"));
  return (
    <header className="ws-bar">
      <Link href="/review" className="ws-brand">
        <span className="ws-brand-mark" aria-hidden="true" />
        Claims workstation
      </Link>
      <nav aria-label="Workstation" className="ws-nav">
        <Link href="/review" aria-current={inQueue ? "page" : undefined}>Claims queue</Link>
        <Link href="/review/demo" aria-current={inDemo ? "page" : undefined}>Guided intake demo</Link>
        <Link href="/call">Customer line</Link>
        <Link href="/">Developer console</Link>
      </nav>
      <p className="ws-notice">
        <strong>Prototype</strong> · synthetic data only · no sign-in or access control · drafts for human review; nothing here moves money
      </p>
    </header>
  );
}
