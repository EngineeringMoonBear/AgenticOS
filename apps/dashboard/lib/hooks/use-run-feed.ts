"use client";
import { useQuery } from "@tanstack/react-query";
import type { RunRecord } from "@/lib/agent";

type RunStatusFilter = RunRecord["status"];

export function useRunFeed(opts?: { status?: RunStatusFilter | RunStatusFilter[]; limit?: number }) {
  return useQuery({
    queryKey: ["agent", "runs", opts],
    staleTime: 10_000,
    gcTime:    30_000,
    queryFn: async (): Promise<RunRecord[]> => {
      const params = new URLSearchParams();
      if (opts?.limit)  params.set("limit", String(opts.limit));
      if (opts?.status) {
        params.set("status", Array.isArray(opts.status) ? opts.status.join(",") : opts.status);
      }
      const res = await fetch(`/api/agent/runs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch runs");
      const json = await res.json();
      return json.runs;
    },
  });
}
