"use client";

import Link from "next/link";
import { SlidersHorizontal, Command } from "lucide-react";
import { HeaderTabs } from "./header-tabs";
import { FilterChip } from "@/components/filter/filter-chip";
import { usePaletteStore } from "@/lib/palette/use-palette-store";

/** AgenticOS logo mark — plum ring with gold inner dot at 2-o'clock position */
function LogoMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer ring — plum stroke */}
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="var(--accent-plum-400)"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Inner dot at ~2-o'clock position (roughly 60° from top = cos60°, -sin60°) */}
      <circle
        cx="14"
        cy="6"
        r="1.5"
        fill="var(--accent-gold-400)"
      />
    </svg>
  );
}

export function Header() {
  const openPalette = usePaletteStore((s) => s.open);
  return (
    <header
      className="sticky top-0 z-50 flex items-center border-b"
      style={{
        height: "56px",
        backgroundColor: "color-mix(in srgb, var(--surface-elevated) 90%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottomColor: "var(--border-subtle)",
      }}
    >
      <div className="flex items-center w-full h-full px-4 gap-0">
        {/* Left: Logo + wordmark */}
        <Link
          href="/architecture"
          className="flex items-center gap-2 mr-6 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--accent-plum-400] rounded-md"
          aria-label="AgenticOS — go to Architecture"
        >
          <LogoMark />
          <span
            className="text-[15px] font-medium tracking-tight"
            style={{ color: "var(--text)" }}
          >
            AgenticOS
          </span>
        </Link>

        {/* Center: Tab navigation (client component for usePathname) */}
        <div className="flex-1 flex items-center h-full">
          <HeaderTabs />
        </div>

        {/* Right: Filter chip placeholder + command palette trigger + settings */}
        <div className="flex items-center gap-1 ml-4 shrink-0">
          {/* Global filter chip */}
          <FilterChip />

          {/* Command palette trigger — wired in Task 8 */}
          <button
            type="button"
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
            style={{
              color: "var(--text-muted)",
            }}
            onClick={openPalette}
            aria-label="Open command palette (⌘K)"
          >
            <Command size={12} strokeWidth={1.5} aria-hidden="true" />
            <kbd
              className="font-mono text-[11px]"
              style={{ fontFamily: "var(--font-jetbrains-mono, monospace)" }}
            >
              K
            </kbd>
          </button>

          {/* Settings */}
          <Link
            href="/settings"
            className="flex items-center justify-center rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--accent-plum-400]"
            style={{ color: "var(--text-muted)" }}
            aria-label="Settings"
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
