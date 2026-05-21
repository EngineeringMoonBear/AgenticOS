"use client";
import { useQuery } from "@tanstack/react-query";

export function useMemoryPeerRep(peer: string = "josh") {
  return useQuery<{ peer: string; representation: unknown }>({
    queryKey: ["memory", "peer-rep", peer],
    queryFn: async () => {
      const res = await fetch(`/api/memory/peer-rep?peer=${encodeURIComponent(peer)}`);
      if (!res.ok) throw new Error("failed to fetch peer rep");
      return res.json();
    },
    staleTime: 60_000,
  });
}
