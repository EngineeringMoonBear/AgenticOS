"use client";
import { useQuery } from "@tanstack/react-query";
import type { IngestRecentData } from "@/app/api/ingest/recent/route";

/**
 * Recent vault-ingest task rows for the Vault-ingest panel.
 *
 *   - /api/ingest/recent → Postgres `tasks` WHERE kind='vault-ingest'
 *     (last 10 runs) + the registered cron expression.
 *
 * 30s polling like use-cost-vista.
 */
export function useIngestRecent() {
  return useQuery<IngestRecentData>({
    queryKey: ["ingest", "recent"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/ingest/recent", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/ingest/recent → HTTP ${res.status}`);
      return (await res.json()) as IngestRecentData;
    },
  });
}
