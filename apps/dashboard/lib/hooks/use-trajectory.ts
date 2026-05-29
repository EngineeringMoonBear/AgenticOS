"use client";
import { useQuery } from "@tanstack/react-query";

export interface TrajectoryNode {
  id: string;
  kind: "uri" | "session";
  label: string;
  size: number;
}

export interface TrajectoryLink {
  source: string;
  target: string;
  weight: number;
  at: string;
}

export interface TrajectoryGraph {
  nodes: TrajectoryNode[];
  links: TrajectoryLink[];
}

export function useTrajectory(uri: string, since?: string) {
  return useQuery<TrajectoryGraph>({
    queryKey: ["memory-trajectory", uri, since],
    queryFn: async () => {
      const params = new URLSearchParams({ uri });
      if (since) params.set("since", since);
      const res = await fetch(`/api/memory/trajectory?${params.toString()}`);
      if (!res.ok) throw new Error("failed to fetch trajectory");
      return res.json();
    },
    enabled: Boolean(uri),
    staleTime: 0,
  });
}
