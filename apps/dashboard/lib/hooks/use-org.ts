"use client";
import { useQuery } from "@tanstack/react-query";
import type { OrgNode } from "@/lib/paperclip/client";

interface OrgResponse {
  org: OrgNode[] | null;
}

export function useOrg() {
  return useQuery<OrgResponse>({
    queryKey: ["org"],
    queryFn: async () => {
      const res = await fetch("/api/org");
      if (!res.ok) throw new Error(`org fetch failed: HTTP ${res.status}`);
      return res.json() as Promise<OrgResponse>;
    },
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}
