"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/live", label: "Live Ops" },
  { href: "/memory", label: "Memory" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b" role="tablist" aria-label="Dashboard tabs">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent opacity-60 hover:opacity-100"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
