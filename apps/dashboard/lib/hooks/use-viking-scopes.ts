"use client";

import { useQuery } from "@tanstack/react-query";
import type { VikingScopes } from "@/app/api/viking/scopes/route";

export function useVikingScopes() {
  return useQuery<VikingScopes, Error>({
    queryKey: ["viking", "scopes"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/viking/scopes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikingScopes;
    },
  });
}
