"use client";

/**
 * Application chrome. Bank staff pages get the workstation rail; the customer line (/call) draws its
 * own canvas, because it stands in for the bank's consumer channel, not the back office.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Inbox, Play, Phone, Wrench } from "lucide-react";

const STAFF_NAV = [
  { href: "/review", label: "Claims queue", icon: Inbox, match: (p: string) => p === "/review" || (p.startsWith("/review/") && p !== "/review/demo") },
  { href: "/review/demo", label: "Demo", icon: Play, match: (p: string) => p === "/review/demo" },
  { href: "/call", label: "Customer line", icon: Phone, match: () => false },
  { href: "/", label: "Developer", icon: Wrench, match: (p: string) => p === "/" || p.startsWith("/cases/") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (pathname === "/call" || pathname.startsWith("/call/")) return <>{children}</>;
  if (pathname === "/review/demo") return <>{children}</>;
  return (
    <div className="shell">
      <aside className="rail" aria-label="Workstation">
        <Link href="/review" className="rail-brand">
          <span>
            <span className="rail-title">Bellhop</span>
            <span className="rail-org">Demo Bank · claims</span>
          </span>
        </Link>
        <nav className="rail-nav">
          {STAFF_NAV.map((n) => {
            const Icon = n.icon;
            const current = n.match(pathname);
            return (
              <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <p className="rail-foot">Synthetic data · simulated money</p>
      </aside>
      <div className="shell-main">{children}</div>
    </div>
  );
}
