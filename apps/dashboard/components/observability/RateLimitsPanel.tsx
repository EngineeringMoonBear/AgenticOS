"use client";
import { useState } from "react";
import { useLimits } from "@/lib/hooks/use-limits";
import { SparklineSvg } from "./SparklineSvg";

function minutesUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function barColor(fraction: number): string {
  if (fraction > 0.95) return "var(--error, #f87171)";
  if (fraction > 0.80) return "var(--accent-gold-400, #c9a227)";
  return "var(--lane-hermes, #4db6ac)";
}

export function RateLimitsPanel() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading } = useLimits();

  if (isLoading) {
    return <div className="text-xs text-muted">Loading rate limits…</div>;
  }
  if (!data?.current) {
    return (
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        No data yet — headers not available from this Hermes version.
      </div>
    );
  }

  const { requests, tokens } = data.current;
  const requestsUsed = 1 - requests.remaining / requests.limit;
  const tokensUsed   = 1 - tokens.remaining / tokens.limit;

  return (
    <section className="space-y-2">
      <header className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
        Rate Limits
      </header>
      <div className="space-y-1.5">
        <Row label="Requests" used={requestsUsed} resetIn={minutesUntil(requests.resetAt)} />
        {expanded && <SparklineSvg history={data.history} field="remainingRequests" limitField="limitRequests" />}
        <Row label="Tokens"   used={tokensUsed}   resetIn={minutesUntil(tokens.resetAt)} />
        {expanded && <SparklineSvg history={data.history} field="remainingTokens" limitField="limitTokens" />}
      </div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="text-xs underline"
        style={{ color: "var(--text-muted)" }}
      >
        {expanded ? "Hide history" : "Show history"}
      </button>
    </section>
  );
}

function Row({ label, used, resetIn }: { label: string; used: number; resetIn: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20" style={{ color: "var(--text-muted)" }}>{label}</span>
      <div className="flex-1 h-2 rounded-sm" style={{ background: "var(--surface, #1a1714)" }}>
        <div
          className="h-2 rounded-sm"
          style={{ width: `${used * 100}%`, background: barColor(used) }}
        />
      </div>
      <span className="w-12 text-right" style={{ color: "var(--text-muted)" }}>
        {(used * 100).toFixed(0)}%
      </span>
      <span className="w-16" style={{ color: "var(--text-muted)" }}>{resetIn}</span>
    </div>
  );
}
