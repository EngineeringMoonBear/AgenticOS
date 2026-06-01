"use client";

import { BarRow } from "@/components/ui/BarRow";
import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { useVikingHealth } from "@/lib/hooks/use-viking-health";
import { useVikingScopes } from "@/lib/hooks/use-viking-scopes";

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

export function OpenVikingSummaryPanel() {
  const health = useVikingHealth();
  const scopes = useVikingScopes();

  const isLoading = health.isLoading || scopes.isLoading;
  const reachable = Boolean(health.data?.reachable || scopes.data?.reachable);
  const total = scopes.data?.total ?? 0;
  const scopeEntries = scopes.data ? Object.entries(scopes.data.scopes) : [];

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={DbIcon}>OpenViking</CardTitle>
        <CardAction>
          {!reachable ? "offline" : `${total.toLocaleString()} total`}
        </CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : !reachable ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          OpenViking unreachable.
        </div>
      ) : scopeEntries.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No memories indexed yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {scopeEntries.map(([scope, count]) => (
            <BarRow
              key={scope}
              name={scope}
              fillPercent={total > 0 ? (count / total) * 100 : 0}
              count={count.toLocaleString()}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
