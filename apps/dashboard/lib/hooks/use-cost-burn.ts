"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * Shape returned by `/api/cost/today` (see app/api/cost/[scope]/route.ts).
 * The endpoint returns `{ summary, tasks }` where `summary` is a CostSummary
 * (see lib/cost/types.ts). We only need the summary fields for the header chip.
 */
export interface CostBurn {
  today_cents: number;
  mtd_cents: number;
  cap_cents: number;
  pct_of_cap: number;
}

interface CostTodayResponse {
  summary: {
    today_cents: number;
    mtd_cents: number;
    cap_cents: number;
    soft_alert_cents: number;
    pct_of_cap: number;
    projected_month_end_cents: number;
  };
}

export function useCostBurn() {
  return useQuery<CostBurn>({
    queryKey: ["cost-burn"],
    queryFn: async () => {
      const r = await fetch("/api/cost/today");
      if (!r.ok) throw new Error(`cost burn HTTP ${r.status}`);
      const data = (await r.json()) as CostTodayResponse;
      return {
        today_cents: data.summary.today_cents,
        mtd_cents: data.summary.mtd_cents,
        cap_cents: data.summary.cap_cents,
        pct_of_cap: data.summary.pct_of_cap,
      };
    },
    refetchInterval: 30_000,
  });
}
