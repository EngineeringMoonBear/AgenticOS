"use client";

import { useQuery } from "@tanstack/react-query";
import type { VikingHealth } from "@/app/api/viking/health/route";

export function useVikingHealth() {
  return useQuery<VikingHealth, Error>({
    queryKey: ["viking", "health"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/viking/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikingHealth;
    },
  });
}
