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
    // The "Synced Ns ago" counter is ticked client-side (MemorySyncIndicator's
    // own 1s setInterval), so this server poll only needs to pick up an actual
    // index rebuild (a new `builtAt`). 15s catches that well before the 30s
    // staleness threshold while cutting load ~15× vs. the previous 1s poll.
    // Manual refresh stays instant — useVaultRevalidate invalidates ["vault"].
    refetchInterval: 15_000,
  });
}
