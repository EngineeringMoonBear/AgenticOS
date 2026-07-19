"use client";
import { useQuery } from "@tanstack/react-query";
import type { SkillsResponse } from "@/app/api/vault/skills/route";

/**
 * Data for the Architecture tab hero vista — two real endpoints, one query.
 *
 * Same degradation contract as use-cost-vista: Promise.allSettled per source,
 * so a failing endpoint nulls ITS tile(s) ("—") without blanking the vista.
 *
 *   - skills    → /api/vault/skills      (vault-server skill registry; domain =
 *                                         path segment after `Skills/`)
 *   - runsToday → /api/agent/runs        (runs started since UTC midnight —
 *                                         same reading as use-kpi-data)
 */
export interface ArchitectureVistaData {
  skills: SkillsResponse | null;
  runsToday: { count: number } | null;
}

interface AgentRunsResponse {
  runs: Array<{ startedAt: string | null; costUsd: number }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function toRunsToday(data: AgentRunsResponse): { count: number } {
  // Count runs started since UTC midnight today (the endpoint returns the
  // most recent runs, capped at limit=200 — covers a normal day's activity).
  const now = new Date();
  const todayMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  let count = 0;
  for (const run of data.runs) {
    if (!run.startedAt) continue;
    const t = new Date(run.startedAt).getTime();
    if (Number.isNaN(t) || t < todayMidnightUtc) continue;
    count += 1;
  }
  return { count };
}

export function useArchitectureVista() {
  return useQuery<ArchitectureVistaData>({
    queryKey: ["architecture-vista"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<ArchitectureVistaData> => {
      const [skills, runs] = await Promise.allSettled([
        fetchJson<SkillsResponse>("/api/vault/skills"),
        fetchJson<AgentRunsResponse>("/api/agent/runs?limit=200"),
      ]);
      return {
        skills: skills.status === "fulfilled" ? skills.value : null,
        runsToday: runs.status === "fulfilled" ? toRunsToday(runs.value) : null,
      };
    },
  });
}
