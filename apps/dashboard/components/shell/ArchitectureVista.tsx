"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import {
  SkillGalaxyBackdrop,
  type SkillGalaxyDomain,
} from "./backdrops/SkillGalaxyBackdrop";

/**
 * Architecture tab hero vista. Composes the {@link VistaShell} chrome
 * with the {@link SkillGalaxyBackdrop} radial cluster and four
 * Architecture-specific KPI tiles (copper accent).
 */

const DOMAINS: SkillGalaxyDomain[] = [
  { name: "Farm", count: 5, dispatchedToday: 14 },
  { name: "Software", count: 3, dispatchedToday: 8 },
  { name: "Marketing", count: 2, dispatchedToday: 3 },
  { name: "Video", count: 1, dispatchedToday: 0 },
  { name: "Personal", count: 0, dispatchedToday: 0 },
];

export function ArchitectureVista() {
  const nowIso = useMemo(() => new Date().toISOString(), []);

  return (
    <VistaShell
      accent="copper"
      asOf={nowIso}
      backdrop={<SkillGalaxyBackdrop domains={DOMAINS} />}
    >
      <KpiTile
        value="11"
        label="registered skills"
        sublabel="5 domains · 2 untagged"
      />
      <KpiTile
        value={
          <>
            25<span className="delta up">+8</span>
          </>
        }
        label="dispatched today"
        sublabel="14 farm · 8 software · 3 marketing"
      />
      <KpiTile
        value={
          <>
            Farm<span className="unit"> (5)</span>
          </>
        }
        label="top domain"
        sublabel="14 dispatches today"
      />
      <KpiTile
        value={
          <>
            farm-task-triage<span className="unit"> (12)</span>
          </>
        }
        label="most-used skill"
        sublabel="last 24h · p50 14s"
      />
    </VistaShell>
  );
}

export default ArchitectureVista;
