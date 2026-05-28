"use client";
import { useQuery } from "@tanstack/react-query";

import { BarRow } from "@/components/ui/BarRow";
import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";

interface ScopeEntry {
  name: string;
  scope: string;
  count: number;
  fill_percent: number;
}

interface MemoryScopesData {
  total: number;
  scopes: ScopeEntry[];
}

const DbIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </svg>
);

function useMemoryScopes() {
  return useQuery<MemoryScopesData>({
    queryKey: ["memory", "scopes"],
    queryFn: async () => {
      const res = await fetch("/api/memory/scopes");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function OpenVikingSummaryPanel() {
  const { data, isLoading } = useMemoryScopes();

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={DbIcon}>OpenViking</CardTitle>
        <CardAction>
          {data ? `${data.total.toLocaleString()} total` : "—"}
        </CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.scopes.map((s) => (
            <BarRow
              key={s.scope}
              name={s.name}
              scope={s.scope}
              fillPercent={s.fill_percent}
              count={s.count.toLocaleString()}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
