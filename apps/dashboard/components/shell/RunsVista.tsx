"use client";
import { useMemo } from "react";
import { VistaShell } from "./VistaShell";
import { KpiTile } from "./KpiTile";
import { ActivityStripBackdrop } from "./backdrops/ActivityStripBackdrop";
import { useRecentRunEvents } from "@/lib/hooks/use-recent-run-events";
import { useRunsStats } from "@/lib/hooks/use-runs-stats";

/**
 * Runs tab hero vista. Composes the {@link VistaShell} chrome with the
 * {@link ActivityStripBackdrop} throughput chart and four Runs-specific
 * KPI tiles backed by the Postgres `tasks` telemetry table:
 *
 *  - `/api/tasks/recent-events?windowMin=60` feeds the chart
 *  - `/api/tasks/stats` feeds the four tiles
 *
 * Both poll every 30s. The chart's `now` reference is pinned to the
 * page mount so bars don't jitter between refetches.
 */
const PLACEHOLDER = "—";

function formatActiveSublabel(activeKinds: string[] | undefined): string {
  if (!activeKinds || activeKinds.length === 0) return "no runs in flight";
  if (activeKinds.length <= 3) return activeKinds.join(" · ");
  const head = activeKinds.slice(0, 2).join(" · ");
  const extra = activeKinds.length - 2;
  return `${head} · +${extra} more`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return PLACEHOLDER;
  }
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds - min * 60);
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

export function RunsVista() {
  // Pin `now` to mount time so the chart axis stays stable for the
  // lifetime of the page render. Refetched data drops into the same
  // 60-minute window without the right edge sliding.
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const eventsQuery = useRecentRunEvents(60);
  const statsQuery = useRunsStats();

  const events = eventsQuery.data ?? [];
  const stats = statsQuery.data;
  const statsLoaded = !!stats;

  return (
    <VistaShell
      accent="gold"
      asOf={nowIso}
      backdrop={<ActivityStripBackdrop events={events} now={nowIso} />}
    >
      <KpiTile
        value={statsLoaded ? String(stats.activeCount) : PLACEHOLDER}
        label="active runs"
        sublabel={
          statsLoaded ? formatActiveSublabel(stats.activeKinds) : "loading…"
        }
      />
      <KpiTile
        value={statsLoaded ? String(stats.failedToday) : PLACEHOLDER}
        label="failed today"
        sublabel={
          statsLoaded && stats.failedToday > 0
            ? "since midnight UTC"
            : statsLoaded
              ? "clean run"
              : "loading…"
        }
      />
      <KpiTile
        value={statsLoaded ? formatDuration(stats.avgDurationSec) : PLACEHOLDER}
        label="avg duration"
        sublabel="p50 · last 24h"
      />
      <KpiTile
        value={PLACEHOLDER}
        label="next scheduled"
        sublabel="cron source pending"
      />
    </VistaShell>
  );
}

export default RunsVista;
