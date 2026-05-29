import Link from "next/link";
import { LanternMushroom } from "@/components/brand/LanternMushroom";
import { TabBar } from "./TabBar";
import { PaletteTrigger } from "@/components/layout/palette-trigger";
import { FilterChip } from "@/components/filter/filter-chip";

/** Settings cog icon — inline SVG to avoid extra lucide-react surface here. */
function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function SharedHeader() {
  return (
    <header className="shell-header">
      <div className="shell-header-row">
        {/* Left: brand mark + wordmark */}
        <Link href="/" className="shell-brand" aria-label="AgenticOS — home">
          <LanternMushroom size={26} />
          <span className="shell-wordmark">
            <span className="agentic">Agentic</span>
            <span className="os">OS</span>
          </span>
        </Link>

        {/* Right: utility buttons (no status chips — those moved to KpiVista) */}
        <div className="shell-header-right">
          <FilterChip />
          <PaletteTrigger />
          <Link
            href="/settings"
            className="shell-tool-icon"
            aria-label="Settings"
          >
            <SettingsIcon />
          </Link>
        </div>
      </div>
      <TabBar />
    </header>
  );
}
