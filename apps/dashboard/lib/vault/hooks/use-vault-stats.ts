"use client";

import { useQuery } from "@tanstack/react-query";
import type { VaultStats } from "@agenticos/vault-core";

async function fetchVaultStats(): Promise<VaultStats> {
  const res = await fetch("/api/vault/stats");
  if (!res.ok) {
    throw new Error(`Failed to fetch vault stats: ${res.status}`);
  }
  return res.json() as Promise<VaultStats>;
}

export function useVaultStats() {
  return useQuery<VaultStats, Error>({
    queryKey: ["vault", "stats"],
    queryFn: fetchVaultStats,
    refetchInterval: 1000,
  });
}
