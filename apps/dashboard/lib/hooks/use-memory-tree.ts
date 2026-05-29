"use client";
import { useQuery } from "@tanstack/react-query";
import type { TreeNode } from "@/lib/api/viking";

export function useMemoryTree(scope: string) {
  return useQuery<{ nodes: TreeNode[] }>({
    queryKey: ["memory-tree", scope],
    queryFn: async () => {
      const res = await fetch(`/api/memory/tree?scope=${encodeURIComponent(scope)}`);
      if (!res.ok) throw new Error("failed to fetch memory tree");
      return res.json();
    },
    staleTime: 30_000,
  });
}
