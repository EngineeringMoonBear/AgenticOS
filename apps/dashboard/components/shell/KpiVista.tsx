"use client";
import { EkgSweep } from "./EkgSweep";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { useKpiData } from "@/lib/hooks/use-kpi-data";

/**
 * The original four-up KPI vista (today's spend / active runs / vault
 * files / memories indexed) with the EKG sweep backdrop. This component
 * is now a thin composition over {@link VistaShell} + {@link EkgSweep};
 * the dusk-indigo chrome lives in `VistaShell`.
 *
 * Used as a temporary placeholder on `/cost`, `/health`, `/memory` until
 * Dispatch 2 introduces per-tab Cost/Health/Memory vistas. The `/runs`
 * and `/architecture` tabs have already been migrated to dedicated
 * vistas (RunsVista, ArchitectureVista).
 */

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDeltaPct(pct: number): string {
  // Typographic minus for negatives ("−18%").
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return `+${pct}%`;
}

export function KpiVista() {
  const { data } = useKpiData();

  const spendDollars = data ? formatDollars(data.todaySpend.cents) : "—";
  const spendDelta = data ? formatDeltaPct(data.todaySpend.deltaPct) : null;
  const spendDeltaDir = data && data.todaySpend.deltaPct < 0 ? "down" : "up";

  const runsCount = data ? data.activeRuns.count.toString() : "—";
  const runsDelta = data ? `+${data.activeRuns.delta}` : null;

  const vaultCount = data ? formatCount(data.vaultFiles.count) : "—";
  const vaultHourly = data
    ? `+${data.vaultFiles.hourly} this hour · 12 dirs`
    : " ";

  const memoriesCount = data ? formatCount(data.memoriesIndexed.count) : "—";

  return (
    <VistaShell accent="gold" backdrop={<EkgSweep />}>
      <KpiTile
        value={
          <>
            <span className="unit">$</span>
            {spendDollars}
            {spendDelta && (
              <span className={`delta ${spendDeltaDir}`}>{spendDelta}</span>
            )}
          </>
        }
        label="today's spend"
        sublabel="$20 daily cap · MTD $46.18 / $200"
      />
      <KpiTile
        value={
          <>
            {runsCount}
            {runsDelta && <span className="delta up">{runsDelta}</span>}
          </>
        }
        label="active runs"
        sublabel="curator · daily-brief · vault-ingest"
      />
      <KpiTile
        value={vaultCount}
        label="vault files"
        sublabel={vaultHourly}
      />
      <KpiTile
        value={memoriesCount}
        label="memories indexed"
        sublabel="resources · agent/skills · user · session"
      />
    </VistaShell>
  );
}

export default KpiVista;
