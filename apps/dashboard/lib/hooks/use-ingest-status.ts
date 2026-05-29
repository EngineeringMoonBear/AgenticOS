"use client";
import { useQuery } from "@tanstack/react-query";

export interface IngestStatus {
  id: string;
  started_at: string;
  status: string;
  metadata: Record<string, unknown> | null;
}

export function useIngestStatus() {
  return useQuery<IngestStatus | null>({
    queryKey: ["memory-ingest-status"],
    queryFn: async () => {
      const res = await fetch(`/api/ingest/status`);
      if (!res.ok) throw new Error("failed to fetch ingest status");
      return res.json();
    },
    staleTime: 30_000,
  });
}
