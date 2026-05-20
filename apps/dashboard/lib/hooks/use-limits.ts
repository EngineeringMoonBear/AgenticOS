"use client";
import { useQuery } from "@tanstack/react-query";
import type { RateLimitsResponse } from "@/lib/limits/types";

export function useLimits() {
  return useQuery({
    queryKey:  ["limits"],
    staleTime: 60_000,
    queryFn: async (): Promise<RateLimitsResponse> => {
      const res = await fetch("/api/limits");
      if (!res.ok) throw new Error("Failed to fetch limits");
      return res.json();
    },
  });
}
