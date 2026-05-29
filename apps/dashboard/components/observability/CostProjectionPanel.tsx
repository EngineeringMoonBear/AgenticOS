"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";

interface CostProjectionData {
  spend_usd: number;
  cap_usd: number;
  mtd_spend_usd: number;
  avg_per_day_usd: number;
  days_remaining: number;
}

const TrendIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 17 9 11 13 15 21 7" />
    <polyline points="14 7 21 7 21 14" />
  </svg>
);

function useCostProjection() {
  return useQuery<CostProjectionData>({
    queryKey: ["cost", "projection"],
    queryFn: async () => {
      const res = await fetch("/api/cost/projection");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5 * 60_000,
  });
}

export function CostProjectionPanel() {
  const { data, isLoading } = useCostProjection();

  const pct = data ? Math.min(100, (data.spend_usd / data.cap_usd) * 100) : 0;

  return (
    <Card lane="gold">
      <CardHead>
        <CardTitle icon={TrendIcon}>Cost projection</CardTitle>
        <CardAction>month-end forecast</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div className="big-num">
              ${data.spend_usd.toFixed(2)}{" "}
              <span className="of">/ ${data.cap_usd}</span>
            </div>
            <Pill variant="ok">{Math.round(pct)}% of cap</Pill>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill gold"
              style={{ width: `${pct}%` }}
            />
          </div>
          <RowList>
            <Row style={{ gridTemplateColumns: "1fr auto", gap: 0, minHeight: 18 }}>
              <span className="meta">MTD spend</span>
              <span className="num" style={{ fontSize: 12 }}>
                ${data.mtd_spend_usd.toFixed(2)}
              </span>
            </Row>
            <Row style={{ gridTemplateColumns: "1fr auto", gap: 0, minHeight: 18 }}>
              <span className="meta">7-day avg / day</span>
              <span className="num" style={{ fontSize: 12 }}>
                ${data.avg_per_day_usd.toFixed(2)}
              </span>
            </Row>
            <Row style={{ gridTemplateColumns: "1fr auto", gap: 0, minHeight: 18 }}>
              <span className="meta">Days remaining</span>
              <span className="num" style={{ fontSize: 12 }}>
                {data.days_remaining}
              </span>
            </Row>
          </RowList>
        </div>
      )}
    </Card>
  );
}
