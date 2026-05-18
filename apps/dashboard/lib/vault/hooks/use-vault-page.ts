"use client";

import { useQuery } from "@tanstack/react-query";
import type { WikiPage } from "@agenticos/vault-core";

async function fetchVaultPage(path: string): Promise<WikiPage | null> {
  const res = await fetch(`/api/vault/page?path=${encodeURIComponent(path)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to fetch vault page: ${res.status}`);
  }
  return res.json() as Promise<WikiPage>;
}

export function useVaultPage(path: string | null) {
  return useQuery<WikiPage | null, Error>({
    queryKey: ["vault", "page", path],
    queryFn: () => fetchVaultPage(path!),
    enabled: !!path,
  });
}
