"use client";

import { useQuery } from "@tanstack/react-query";
import type { TreeNode } from "@agenticos/vault-core";

interface VaultTreeResponse {
  tree: TreeNode;
  flatPaths: string[];
}

async function fetchVaultTree(): Promise<VaultTreeResponse> {
  const res = await fetch("/api/vault/tree");
  if (!res.ok) {
    throw new Error(`Failed to fetch vault tree: ${res.status}`);
  }
  return res.json() as Promise<VaultTreeResponse>;
}

export function useVaultTree() {
  return useQuery<VaultTreeResponse, Error>({
    queryKey: ["vault", "tree"],
    queryFn: fetchVaultTree,
  });
}
