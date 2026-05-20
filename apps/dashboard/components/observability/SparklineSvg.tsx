"use client";
import type { RateLimitSample } from "@/lib/limits/types";

export function SparklineSvg({
  history,
  width = 120,
  height = 24,
  field = "remainingTokens",
  limitField = "limitTokens",
}: {
  history: RateLimitSample[];
  width?: number;
  height?: number;
  field?: "remainingTokens" | "remainingRequests";
  limitField?: "limitTokens" | "limitRequests";
}) {
  if (history.length === 0) {
    return <svg width={width} height={height} aria-hidden />;
  }
  // 24 hourly buckets, latest on the right.
  const nowMs = history.reduce((max, s) => Math.max(max, new Date(s.ts).getTime()), 0);
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const cutoffStart = nowMs - (24 - i) * 60 * 60 * 1000;
    const cutoffEnd   = nowMs - (23 - i) * 60 * 60 * 1000;
    const samples = history.filter((s) => {
      const t = new Date(s.ts).getTime();
      return t >= cutoffStart && t < cutoffEnd;
    });
    if (samples.length === 0) return null;
    const last = samples[samples.length - 1]!;
    return (last[field] as number) / (last[limitField] as number);
  });
  const barWidth = width / 24;
  return (
    <svg width={width} height={height} aria-label="24h rate limit history">
      {buckets.map((frac, i) => {
        if (frac === null) return null;
        const h = Math.max(1, frac * height);
        const color = frac < 0.2 ? "var(--accent-gold-400, #c9a227)" : "var(--lane-hermes, #4db6ac)";
        return (
          <rect
            key={i}
            x={i * barWidth}
            y={height - h}
            width={Math.max(1, barWidth - 1)}
            height={h}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
