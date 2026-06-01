import type { ReactNode } from "react";

/**
 * Single KPI tile rendered inside a {@link VistaShell}. The visual style
 * (typography, halo, dividers between adjacent tiles) lives entirely in
 * `globals.css` under `.kpi-grid > .kpi` — this component is a thin
 * structural wrapper so every per-tab vista can compose its own tiles
 * without re-implementing the chrome.
 */
export interface KpiTileProps {
  /**
   * The headline value. May include rich children such as `<span class="unit">`
   * for currency prefixes or `<span class="delta up|down">` badges.
   */
  value: ReactNode;
  /** Small-caps caption beneath the value. */
  label: string;
  /** Optional mono-font detail line beneath the label. */
  sublabel?: ReactNode;
}

export function KpiTile({ value, label, sublabel }: KpiTileProps) {
  return (
    <dl className="kpi">
      <dd className="value">{value}</dd>
      <dt className="label">{label}</dt>
      {sublabel !== undefined && <dd className="sublabel">{sublabel}</dd>}
    </dl>
  );
}

export default KpiTile;
