"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Progress, type ProgressVariant } from "@/components/ui/Progress";

interface ResourceMetric {
  name: string;
  percent: number;
  detail: string;
}

interface SystemResourcesData {
  cpu: ResourceMetric;
  ram: ResourceMetric;
  disk: ResourceMetric;
  meta: string;
}

const ServerIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="6" rx="1" />
    <rect x="3" y="14" width="18" height="6" rx="1" />
    <circle cx="7" cy="7" r="0.7" fill="currentColor" />
    <circle cx="7" cy="17" r="0.7" fill="currentColor" />
    <line x1="11" y1="7" x2="17" y2="7" />
    <line x1="11" y1="17" x2="17" y2="17" />
  </svg>
);

function variantFor(pct: number): ProgressVariant {
  if (pct >= 85) return "gold";
  if (pct >= 60) return "amber";
  return "pine";
}

function useSystemResources() {
  return useQuery<SystemResourcesData>({
    queryKey: ["health", "resources"],
    queryFn: async () => {
      const res = await fetch("/api/health/resources");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function SystemResourcesPanel() {
  const { data, isLoading } = useSystemResources();

  const metrics = data ? [data.cpu, data.ram, data.disk] : [];
  const anyHot = metrics.some((m) => m.percent >= 60);
  const lane = anyHot ? "amber" : "pine";

  return (
    <Card lane={lane}>
      <CardHead>
        <CardTitle icon={ServerIcon}>System resources</CardTitle>
        <CardAction>{data?.meta ?? "—"}</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {metrics.map((m) => (
            <Progress
              key={m.name}
              name={m.name}
              count={m.detail}
              percent={m.percent}
              variant={variantFor(m.percent)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
