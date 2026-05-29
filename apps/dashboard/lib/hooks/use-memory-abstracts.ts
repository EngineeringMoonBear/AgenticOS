"use client";
import { useQuery } from "@tanstack/react-query";

export interface AbstractItem {
  uri: string;
  name: string;
  abstract: string;
}

export function useMemoryAbstracts(uri: string) {
  return useQuery<{ items: AbstractItem[] }>({
    queryKey: ["memory-abstracts", uri],
    queryFn: async () => {
      const res = await fetch(`/api/memory/abstracts?uri=${encodeURIComponent(uri)}`);
      if (!res.ok) throw new Error("failed to fetch memory abstracts");
      return res.json();
    },
    enabled: Boolean(uri),
    staleTime: 30_000,
  });
}
