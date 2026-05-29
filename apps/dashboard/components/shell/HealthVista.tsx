"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { LatencyOscilloscopeBackdrop } from "./backdrops/LatencyOscilloscopeBackdrop";

/**
 * Health tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link LatencyOscilloscopeBackdrop} 4-channel oscilloscope and the
 * four Health-specific KPI tiles. Stub data lives here until a later
 * dispatch wires it to the live health query.
 */
export function HealthVista() {
  const nowIso = useMemo(() => new Date().toISOString(), []);

  return (
    <VistaShell
      accent="pine"
      asOf={nowIso}
      backdrop={<LatencyOscilloscopeBackdrop />}
    >
      <KpiTile
        value={
          <>
            4<span className="unit"> / 4</span>
          </>
        }
        label="services up"
        sublabel="all responding"
      />
      <KpiTile
        value={
          <>
            5<span className="unit">ms</span>
          </>
        }
        label="avg latency"
        sublabel="p50 across stack"
      />
      <KpiTile
        value="99.94%"
        label="uptime"
        sublabel="30-day rolling"
      />
      <KpiTile
        value="none"
        label="last incident"
        sublabel="last 14 days"
      />
    </VistaShell>
  );
}

export default HealthVista;
