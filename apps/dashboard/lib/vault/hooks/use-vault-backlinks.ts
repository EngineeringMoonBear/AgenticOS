"use client";

import { useQuery } from "@tanstack/react-query";

interface BacklinksResponse {
  backlinks: string[];
}

async function fetchVaultBacklinks(path: string): Promise<string[]> {
  const res = await fetch(`/api/vault/backlinks?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch backlinks: ${res.status}`);
  }
  const data = (await res.json()) as BacklinksResponse;
  return data.backlinks;
}

export function useVaultBacklinks(path: string | null) {
  return useQuery<string[], Error>({
    queryKey: ["vault", "backlinks", path],
    queryFn: () => fetchVaultBacklinks(path!),
    enabled: !!path,
  });
}
