import type { ReactNode } from "react";

/**
 * Dusk-indigo console chrome shared by every per-tab vista. Renders the
 * background panel + dual-radial spotlight + gold horizon rules + live
 * indicator chip + KPI tile slot. The animated backdrop (EKG sweep,
 * activity strip, skill galaxy, etc.) is passed in via the `backdrop`
 * prop so each tab can supply a topic-appropriate visual without
 * duplicating the chrome.
 *
 * The optional `accent` prop tints the live indicator dot and the KPI
 * text-shadow halo via a `data-accent` attribute that `globals.css`
 * selects on (see `.kpi-vista[data-accent="copper"] .kpi .value`).
 */
export interface VistaShellProps {
  /**
   * Accent color for KPI value halos and the live indicator dot.
   * Defaults to `'gold'` (the original KpiVista appearance).
   */
  accent?: "gold" | "copper" | "amber" | "pine" | "sage";
  /** ISO time shown in the "Live · as of HH:MM:SS" indicator. */
  asOf?: string;
  /** The 4 KPI tiles, typically `<KpiTile />` children. */
  children: ReactNode;
  /** The animated backdrop component (absolutely-positioned, full-bleed). */
  backdrop: ReactNode;
}

function formatTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function VistaShell({
  accent = "gold",
  asOf,
  children,
  backdrop,
}: VistaShellProps) {
  return (
    <div className="kpi-vista" data-accent={accent}>
      {backdrop}

      <div className="vista-meta" aria-label="Live data indicator">
        <span className="live-dot" aria-hidden="true" />
        <span>Live · as of {formatTime(asOf)}</span>
      </div>

      <div className="horizon top" />

      <div className="kpi-grid">{children}</div>

      <div className="horizon bottom" />
    </div>
  );
}

export default VistaShell;
