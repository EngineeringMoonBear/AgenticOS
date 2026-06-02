"use client";

import { useQuery } from "@tanstack/react-query";
import type { SkillsResponse } from "@/app/api/vault/skills/route";

async function fetchVaultSkills(): Promise<SkillsResponse> {
  const res = await fetch("/api/vault/skills", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch vault skills: ${res.status}`);
  }
  return res.json() as Promise<SkillsResponse>;
}

export function useVaultSkills() {
  return useQuery<SkillsResponse, Error>({
    queryKey: ["vault", "skills"],
    queryFn: fetchVaultSkills,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
