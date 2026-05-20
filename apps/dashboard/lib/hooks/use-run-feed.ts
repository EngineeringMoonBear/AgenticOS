"use client";
import { useQuery } from "@tanstack/react-query";
import type { HermesRun, RunStatus } from "@agenticos/hermes-client";

export function useRunFeed(opts?: { status?: RunStatus | RunStatus[]; limit?: number }) {
  return useQuery({
    queryKey: ["hermes", "runs", opts],
    staleTime: 10_000,
    gcTime:    30_000,
    queryFn: async (): Promise<HermesRun[]> => {
      const params = new URLSearchParams();
      if (opts?.limit)  params.set("limit", String(opts.limit));
      if (opts?.status) {
        params.set("status", Array.isArray(opts.status) ? opts.status.join(",") : opts.status);
      }
      const res = await fetch(`/api/hermes/runs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch runs");
      const json = await res.json();
      return json.runs;
    },
  });
}
