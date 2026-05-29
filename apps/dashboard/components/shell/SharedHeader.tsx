import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { CostBurnChip } from "./CostBurnChip";
import { MaxQuotaChip } from "./MaxQuotaChip";
import { AgentStatusChip } from "@/components/observability/AgentStatusChip";
import { TabBar } from "./TabBar";
import { PaletteTrigger } from "@/components/layout/palette-trigger";
import { FilterChip } from "@/components/filter/filter-chip";

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
      <circle cx="10" cy="10" r="8" stroke="var(--accent-plum-400)" strokeWidth="1.5" fill="none" />
      <circle cx="14" cy="6" r="1.5" fill="var(--accent-gold-400)" />
    </svg>
  );
}

export function SharedHeader() {
  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        backgroundColor: "color-mix(in srgb, var(--surface-elevated) 90%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottomColor: "var(--border-subtle)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 gap-4">
        {/* Left: brand */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--accent-plum-400] rounded-md"
          aria-label="AgenticOS — home"
        >
          <LogoMark />
          <span
            className="text-[15px] font-medium tracking-tight"
            style={{ color: "var(--text)" }}
          >
            AgenticOS
          </span>
        </Link>

        {/* Right: chips + utilities */}
        <div className="flex items-center gap-2 shrink-0">
          <CostBurnChip />
          <AgentStatusChip />
          <MaxQuotaChip />
          <FilterChip />
          <PaletteTrigger />
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
      <TabBar />
    </header>
  );
}
