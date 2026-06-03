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
 * /health, /memory. Every tile degrades independently: a tile whose source
 * fetch failed shows "—" with no delta badge or fabricated sublabel, while
 * the others keep showing live data.
 */

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDeltaPct(pct: number): string {
  // Typographic minus for negatives, to match the mockup ("−18%").
  if (pct < 0) return `−${Math.abs(pct)}%`;
  return `+${pct}%`;
}

function formatDeltaCount(n: number): string {
  if (n < 0) return `−${Math.abs(n)}`;
  return `+${n}`;
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

  const spend = data?.todaySpend ?? null;
  const runs = data?.activeRuns ?? null;
  const vault = data?.vaultFiles ?? null;
  const memories = data?.memoriesIndexed ?? null;

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
            {spend ? formatDollars(spend.cents) : "—"}
            {spend && spend.deltaPct !== null && (
              <span className={`delta ${spend.deltaPct < 0 ? "down" : "up"}`}>
                {formatDeltaPct(spend.deltaPct)}
              </span>
            )}
          </div>
          <div className="label">today&apos;s spend</div>
          <div className="sublabel">
            {spend
              ? `MTD $${formatDollars(spend.mtdCents)} / $${formatDollars(spend.capCents)}`
              : " "}
          </div>
        </div>

        <div className="kpi">
          <div className="value">
            {runs ? runs.count.toString() : "—"}
            {runs && runs.delta !== 0 && (
              <span className={`delta ${runs.delta < 0 ? "down" : "up"}`}>
                {formatDeltaCount(runs.delta)}
              </span>
            )}
          </div>
          <div className="label">active runs</div>
          <div className="sublabel">
            {runs ? (runs.kinds.length > 0 ? runs.kinds.join(" · ") : "idle") : " "}
          </div>
        </div>

        <div className="kpi">
          <div className="value">{vault ? formatCount(vault.count) : "—"}</div>
          <div className="label">vault files</div>
          <div className="sublabel">{vault ? "wiki pages indexed" : " "}</div>
        </div>

        <div className="kpi">
          <div className="value">{memories ? formatCount(memories.count) : "—"}</div>
          <div className="label">memories indexed</div>
          <div className="sublabel">
            {memories && memories.categories.length > 0
              ? memories.categories.join(" · ")
              : " "}
          </div>
        </div>
      </div>

      <div className="horizon bottom" />
    </div>
  );
}

export default KpiVista;
