"use client";
import { useQuery } from "@tanstack/react-query";
import type { Detail } from "@/lib/api/viking";

export function useMemoryDetail(uri: string, offset?: number, limit?: number) {
  return useQuery<Detail>({
    queryKey: ["memory-detail", uri, offset, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ uri });
      if (offset !== undefined) params.set("offset", String(offset));
      if (limit !== undefined) params.set("limit", String(limit));
      const res = await fetch(`/api/memory/detail?${params.toString()}`);
      if (!res.ok) throw new Error("failed to fetch memory detail");
      return res.json();
    },
    enabled: Boolean(uri),
    staleTime: 30_000,
  });
}
