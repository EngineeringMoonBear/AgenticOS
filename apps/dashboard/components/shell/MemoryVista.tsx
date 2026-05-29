"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { MemoryAccumulationBackdrop } from "./backdrops/MemoryAccumulationBackdrop";

/**
 * Memory tab hero vista. Composes the {@link VistaShell} chrome with
 * the {@link MemoryAccumulationBackdrop} stacked-area chart and the
 * four Memory-specific KPI tiles. Stub data lives here until a later
 * dispatch wires it to the live memory query.
 */
export function MemoryVista() {
  const nowIso = useMemo(() => new Date().toISOString(), []);

  return (
    <VistaShell
      accent="sage"
      asOf={nowIso}
      backdrop={<MemoryAccumulationBackdrop />}
    >
      <KpiTile
        value="1,652"
        label="total memories"
        sublabel="4 scopes"
      />
      <KpiTile
        value={
          <>
            47<span className="delta up">+2.8%</span>
          </>
        }
        label="indexed today"
        sublabel="+2.8% growth"
      />
      <KpiTile
        value="resources"
        label="top scope"
        sublabel="1,204 items (73%)"
      />
      <KpiTile
        value={
          <>
            2m<span className="unit"> ago</span>
          </>
        }
        label="last sync"
        sublabel="syncthing healthy"
      />
    </VistaShell>
  );
}

export default MemoryVista;
