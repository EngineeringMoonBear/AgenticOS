"use client";
import { useQuery } from "@tanstack/react-query";
import type { CostProjectionData } from "@/app/api/cost/projection/route";
import type { BurndownPoint } from "@/app/api/cost/burndown/route";

/**
 * Data for the Cost tab hero vista — three real endpoints, one query.
 *
 * Same degradation contract as use-kpi-data: Promise.allSettled per source,
 * so a failing endpoint nulls ITS tile(s) ("—") without blanking the vista.
 *
 *   - today      → /api/cost/today        (today/yesterday/MTD/cap, cents)
 *   - projection → /api/cost/projection   (month-end projection at current burn)
 *   - burndown   → /api/cost/burndown?range=30d (per-day spend, feeds the backdrop)
 */
export interface CostVistaData {
  today: {
    todayUsd: number;
    yesterdayUsd: number;
    mtdUsd: number;
    capUsd: number; // 0 = no cap configured
  } | null;
  projection: CostProjectionData | null;
  burndown: BurndownPoint[] | null;
}

interface CostTodayResponse {
  summary: {
    today_cents: number;
    yesterday_cents: number;
    cap_cents: number;
    mtd_cents: number;
  };
}

interface BurndownResponse {
  range: string;
  bucket: string;
  points: BurndownPoint[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function useCostVista() {
  return useQuery<CostVistaData>({
    queryKey: ["cost-vista"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<CostVistaData> => {
      const [today, projection, burndown] = await Promise.allSettled([
        fetchJson<CostTodayResponse>("/api/cost/today"),
        fetchJson<CostProjectionData>("/api/cost/projection"),
        fetchJson<BurndownResponse>("/api/cost/burndown?range=30d"),
      ]);
      return {
        today:
          today.status === "fulfilled"
            ? {
                todayUsd: today.value.summary.today_cents / 100,
                yesterdayUsd: today.value.summary.yesterday_cents / 100,
                mtdUsd: today.value.summary.mtd_cents / 100,
                capUsd: today.value.summary.cap_cents / 100,
              }
            : null,
        projection: projection.status === "fulfilled" ? projection.value : null,
        burndown: burndown.status === "fulfilled" ? burndown.value.points : null,
      };
    },
  });
}
