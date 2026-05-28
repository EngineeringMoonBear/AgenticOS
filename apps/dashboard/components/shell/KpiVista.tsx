"use client";
import { EkgSweep } from "./EkgSweep";
import { useKpiData } from "@/lib/hooks/use-kpi-data";

/**
 * Persistent KPI vista banner — the "dusk navigator's console" that sits
 * above every tab. Four readings (today's spend, active runs, vault files,
 * memories indexed) framed by gold horizon rules, with an EKG sweep
 * pulsing in the background and a live-data indicator in the corner.
 *
 * Mounts once in the root layout and persists across /runs, /cost,
 * /health, /memory.
 */

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDeltaPct(pct: number): string {
  // Use the typographic minus from the mockup ("−18%") for negatives.
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return `+${pct}%`;
}

function liveTimestamp(): string {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function KpiVista() {
  const { data } = useKpiData();

  // Loading state: render the chrome with em-dashes so layout is stable.
  const spendDollars = data ? formatDollars(data.todaySpend.cents) : "—";
  const spendDelta = data ? formatDeltaPct(data.todaySpend.deltaPct) : null;
  const spendDeltaDir = data && data.todaySpend.deltaPct < 0 ? "down" : "up";

  const runsCount = data ? data.activeRuns.count.toString() : "—";
  const runsDelta = data ? `+${data.activeRuns.delta}` : null;

  const vaultCount = data ? formatCount(data.vaultFiles.count) : "—";
  const vaultHourly = data ? `+${data.vaultFiles.hourly} this hour · 12 dirs` : " ";

  const memoriesCount = data ? formatCount(data.memoriesIndexed.count) : "—";

  return (
    <div className="kpi-vista">
      <EkgSweep />

      <div className="vista-meta" aria-label="Live data indicator">
        <span className="live-dot" aria-hidden="true" />
        <span>Live · as of {liveTimestamp()}</span>
      </div>

      <div className="horizon top" />

      <div className="kpi-grid">
        <div className="kpi">
          <div className="value">
            <span className="unit">$</span>
            {spendDollars}
            {spendDelta && (
              <span className={`delta ${spendDeltaDir}`}>{spendDelta}</span>
            )}
          </div>
          <div className="label">today&apos;s spend</div>
          <div className="sublabel">$20 daily cap · MTD $46.18 / $200</div>
        </div>

        <div className="kpi">
          <div className="value">
            {runsCount}
            {runsDelta && <span className="delta up">{runsDelta}</span>}
          </div>
          <div className="label">active runs</div>
          <div className="sublabel">curator · daily-brief · vault-ingest</div>
        </div>

        <div className="kpi">
          <div className="value">{vaultCount}</div>
          <div className="label">vault files</div>
          <div className="sublabel">{vaultHourly}</div>
        </div>

        <div className="kpi">
          <div className="value">{memoriesCount}</div>
          <div className="label">memories indexed</div>
          <div className="sublabel">resources · agent/skills · user · session</div>
        </div>
      </div>

      <div className="horizon bottom" />
    </div>
  );
}

export default KpiVista;
