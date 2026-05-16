"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_TABS = [
  { label: "Architecture", href: "/architecture" },
  { label: "Memory", href: "/memory" },
  { label: "Observability", href: "/observability" },
] as const;

export function HeaderTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-0 h-full"
      aria-label="Main navigation"
    >
      {NAV_TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex h-full items-center px-4 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--accent-plum-400]",
              isActive
                ? "text-[--accent-plum-300]"
                : "text-[--text-secondary] hover:text-[--text]"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ backgroundColor: "var(--accent-plum-400)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
