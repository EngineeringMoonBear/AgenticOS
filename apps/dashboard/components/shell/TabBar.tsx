"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface TabDef {
  href: string;
  label: string;
  /** Hard-coded count badge for Phase 3.5.3 — wired to live data in Task 3.5.4. */
  count: string;
}

const TABS: readonly TabDef[] = [
  { href: "/runs", label: "Runs", count: "3" },
  { href: "/cost", label: "Cost", count: "$2.41" },
  { href: "/health", label: "Health", count: "2 warn" },
  { href: "/memory", label: "Memory", count: "1,652" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="shell-tabs" role="tablist" aria-label="Dashboard">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className="shell-tab"
          >
            {t.label}
            <span className="count">{t.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
