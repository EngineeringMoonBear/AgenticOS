"use client";
import { useQuery } from "@tanstack/react-query";
import type { Overview } from "@/lib/api/viking";

export function useMemoryOverview(uri: string) {
  return useQuery<Overview>({
    queryKey: ["memory-overview", uri],
    queryFn: async () => {
      const res = await fetch(`/api/memory/overview?uri=${encodeURIComponent(uri)}`);
      if (!res.ok) throw new Error("failed to fetch memory overview");
      return res.json();
    },
    enabled: Boolean(uri),
    staleTime: 30_000,
  });
}
