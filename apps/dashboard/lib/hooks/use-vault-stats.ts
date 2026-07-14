"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * Vault index stats from /api/vault/stats (vault-server page index).
 * `builtAt` is epoch ms of the last index build — the honest "last sync"
 * signal the Memory vista shows.
 */
export interface VaultStats {
  pageCount: number;
  builtAt: number;
  ttlExpiresAt?: number;
}

export function useVaultStats() {
  return useQuery<VaultStats, Error>({
    queryKey: ["vault", "stats"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/vault/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VaultStats;
    },
  });
}
