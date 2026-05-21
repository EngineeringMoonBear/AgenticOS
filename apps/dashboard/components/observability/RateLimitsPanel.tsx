"use client";
import { useQuery } from "@tanstack/react-query";

interface Run {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

interface QuotaView {
  windowStart: string;
  windowEnd: string;
  totalCostUsd: number;
  totalTokens: number;
  runCount: number;
  // Max quota is roughly ~50 messages per 5h window (Claude Code 5x Pro)
  estimatedQuotaUsedPct: number;
}

const MAX_QUOTA_MESSAGES_5H = 50;

function computeQuota(runs: Run[]): QuotaView {
  const now = new Date();
  const windowMs = 5 * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs);
  const recent = runs.filter((r) => new Date(r.startedAt) >= windowStart);
  const totalCostUsd = recent.reduce((acc, r) => acc + r.costUsd, 0);
  const totalTokens = recent.reduce((acc, r) => acc + r.inputTokens + r.outputTokens, 0);
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    totalCostUsd,
    totalTokens,
    runCount: recent.length,
    estimatedQuotaUsedPct: Math.min(100, (recent.length / MAX_QUOTA_MESSAGES_5H) * 100),
  };
}

export function RateLimitsPanel() {
  const { data, isLoading } = useQuery<{ runs: Run[] }>({
    queryKey: ["agent", "runs", "for-quota"],
    queryFn: async () => {
      const res = await fetch("/api/agent/runs?limit=100");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return null;

  const quota = computeQuota(data.runs);

  return (
    <div className="p-4 space-y-3 border rounded-md">
      <h3 className="text-sm font-medium">Claude Max quota (last 5h)</h3>
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {quota.runCount}/{MAX_QUOTA_MESSAGES_5H} messages
        </div>
        <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${quota.estimatedQuotaUsedPct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs pt-2">
          <div>
            <div className="text-muted-foreground">Cost</div>
            <div className="font-mono">${quota.totalCostUsd.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Tokens</div>
            <div className="font-mono">{quota.totalTokens.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
