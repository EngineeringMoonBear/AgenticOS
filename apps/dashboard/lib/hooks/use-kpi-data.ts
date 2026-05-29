"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * Data shape for the persistent KPI vista banner.
 *
 * TODO(v2): wire these to real endpoints. Today they are hardcoded to match
 * the approved mockup (`docs/design/v2-ui-mockup.html`). Future hookup:
 *   - todaySpend       → /api/cost/today (summary.today_cents + delta vs. yesterday)
 *   - activeRuns       → /api/tasks/active (running tasks + delta vs. last sample)
 *   - vaultFiles       → /api/ingest/status (total files + count added in last hour)
 *   - memoriesIndexed  → /api/memory/stats (total memory rows)
 */
export interface KpiData {
  todaySpend: { cents: number; deltaPct: number };
  activeRuns: { count: number; delta: number };
  vaultFiles: { count: number; hourly: number };
  memoriesIndexed: { count: number };
}

export function useKpiData() {
  return useQuery<KpiData>({
    queryKey: ["kpi-data"],
    queryFn: async () => {
      // STUB: hardcoded mockup values. See TODO above.
      return {
        todaySpend: { cents: 241, deltaPct: -18 },
        activeRuns: { count: 3, delta: 1 },
        vaultFiles: { count: 2847, hourly: 5 },
        memoriesIndexed: { count: 1204 },
      };
    },
    staleTime: 30_000,
  });
}
