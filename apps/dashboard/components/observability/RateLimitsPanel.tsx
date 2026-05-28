"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Progress, type ProgressVariant } from "@/components/ui/Progress";

interface RateLimitLine {
  name: string;
  used: number;
  cap: number;
  detail: string;
  variant: ProgressVariant;
}

interface RateLimitsData {
  provider: string;
  resets_label: string;
  lines: RateLimitLine[];
}

const ClockIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

function useRateLimits() {
  return useQuery<RateLimitsData>({
    queryKey: ["cost", "rate-limits"],
    queryFn: async () => {
      const res = await fetch("/api/cost/rate-limits");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function RateLimitsPanel() {
  const { data, isLoading } = useRateLimits();
  const action = data ? `${data.provider} · ${data.resets_label}` : "—";

  return (
    <Card lane="amber">
      <CardHead>
        <CardTitle icon={ClockIcon}>Rate limits</CardTitle>
        <CardAction>{action}</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.lines.map((l) => {
            const pct = l.cap === 0 ? 0 : (l.used / l.cap) * 100;
            return (
              <Progress
                key={l.name}
                name={l.name}
                count={l.detail}
                percent={pct}
                variant={l.variant}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
