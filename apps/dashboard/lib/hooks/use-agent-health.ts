"use client";
import { useQuery } from "@tanstack/react-query";
import type { HermesHealth } from "@agenticos/hermes-client";

export function useHermesHealth() {
  return useQuery({
    queryKey:  ["hermes", "health"],
    refetchInterval: 5000,
    queryFn:   async (): Promise<HermesHealth> => {
      const res = await fetch("/api/hermes/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
  });
}
