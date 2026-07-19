"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";

/**
 * System resources panel. The backing route (/api/health/resources) reports
 * that no metrics source is connected yet — the real source will be the
 * OpenObserve `system_*` streams (GOL-313). Until then this panel renders
 * honest "—" placeholders instead of the fabricated CPU/RAM/disk percentages
 * it used to show (truth pass 2026-07-14).
 */

const PLACEHOLDER = "—";
const METRIC_NAMES = ["CPU", "RAM", "Disk"] as const;

interface SystemResourcesData {
  available: false;
  reason: string;
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

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={ServerIcon}>System resources</CardTitle>
        <CardAction>{data ? data.reason : PLACEHOLDER}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {METRIC_NAMES.map((name) => (
            <div
              key={name}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span className="label-strong">{name}</span>
              <span className="num muted">{PLACEHOLDER}</span>
            </div>
          ))}
          <div
            className="meta"
            style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
          >
            awaiting OpenObserve wiring (GOL-313)
          </div>
        </div>
      )}
    </Card>
  );
}
