"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * Data for the persistent KPI vista banner — wired to real endpoints.
 *
 * Four independent readings, each degrading on its own: if a source fetch
 * fails, that tile is `null` (renders "—" with no delta/sublabel) while the
 * others still show live data. The query itself never rejects (Promise.allSettled),
 * so a single down service never blanks the whole banner.
 *
 *   - runsToday       → /api/agent/runs  (runs started since UTC midnight; metered $ summed)
 *   - activeRuns      → /api/tasks/queue-depth (queued+running, delta vs in-flight 1h ago)
 *   - vaultFiles      → /api/vault/stats  (vault-server page index count)
 *   - memoriesIndexed → /api/viking/scopes (OpenViking /api/v1/stats/memories)
 *
 * Why "runs today" and not "today's spend": agents run on the Claude Max
 * subscription (flat-rate OAuth), which emits no per-token cost — spend reads
 * ~$0 regardless of activity. Run count is the meaningful activity signal;
 * `spendUsd` still surfaces any metered (API-billed) cost when it is non-zero.
 */
export interface KpiData {
  runsToday: {
    count: number;
    spendUsd: number; // metered cost today — 0 on a flat-rate subscription
  } | null;
  activeRuns: {
    count: number;
    delta: number; // now − in-flight one hour ago
    kinds: string[]; // distinct running/queued kinds, for the sublabel
  } | null;
  vaultFiles: { count: number } | null;
  memoriesIndexed: {
    count: number;
    categories: string[]; // scope keys, for the sublabel
  } | null;
}

interface AgentRunsResponse {
  runs: Array<{ startedAt: string | null; costUsd: number }>;
}

interface QueueDepthResponse {
  rows: Array<{ kind: string; status: string; count: number }>;
  asOf1hCount: number;
}

interface VaultStatsResponse {
  pageCount: number;
}

interface VikingScopesResponse {
  reachable: boolean;
  total: number;
  scopes: Record<string, number>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function toRunsToday(data: AgentRunsResponse): KpiData["runsToday"] {
  // Count runs started since UTC midnight today. The endpoint returns the most
  // recent runs (capped at limit=200), which covers a normal day's activity.
  const now = new Date();
  const todayMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  let count = 0;
  let spendUsd = 0;
  for (const run of data.runs) {
    if (!run.startedAt) continue;
    const t = new Date(run.startedAt).getTime();
    if (Number.isNaN(t) || t < todayMidnightUtc) continue;
    count += 1;
    spendUsd += run.costUsd ?? 0;
  }
  return { count, spendUsd };
}

function toRuns(data: QueueDepthResponse): KpiData["activeRuns"] {
  const count = data.rows.reduce((acc, r) => acc + r.count, 0);
  const kinds = [...new Set(data.rows.map((r) => r.kind))];
  return { count, delta: count - data.asOf1hCount, kinds };
}

function toMemories(data: VikingScopesResponse): KpiData["memoriesIndexed"] {
  // Degrade this ONE tile to null (renders "—") when OpenViking is unreachable.
  // Must not throw: this runs inside the queryFn's return-object construction,
  // AFTER Promise.allSettled, so a throw here escapes queryFn and fails the
  // WHOLE query — blanking all four tiles instead of just this one, defeating
  // the per-tile isolation the banner is built around.
  if (!data.reachable) return null;
  const categories = Object.entries(data.scopes)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
  return { count: data.total, categories };
}

export function useKpiData() {
  return useQuery<KpiData>({
    queryKey: ["kpi-data"],
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<KpiData> => {
      const [runsToday, runs, vault, memories] = await Promise.allSettled([
        fetchJson<AgentRunsResponse>("/api/agent/runs?limit=200"),
        fetchJson<QueueDepthResponse>("/api/tasks/queue-depth"),
        fetchJson<VaultStatsResponse>("/api/vault/stats"),
        fetchJson<VikingScopesResponse>("/api/viking/scopes"),
      ]);
      return {
        runsToday:
          runsToday.status === "fulfilled" ? toRunsToday(runsToday.value) : null,
        activeRuns: runs.status === "fulfilled" ? toRuns(runs.value) : null,
        vaultFiles:
          vault.status === "fulfilled" ? { count: vault.value.pageCount } : null,
        memoriesIndexed:
          memories.status === "fulfilled" ? toMemories(memories.value) : null,
      };
    },
  });
}
