"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";

interface ServiceHealth {
  name: string;
  latency_ms: number;
  ok: boolean;
}

interface AgentHealthData {
  services: ServiceHealth[];
  checked_at: string;
}

const TargetIcon = (
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
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);

function formatAge(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function useAgentHealth() {
  return useQuery<AgentHealthData>({
    queryKey: ["health", "services"],
    queryFn: async () => {
      const res = await fetch("/api/health/services");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5_000,
  });
}

export function AgentHealthPanel() {
  const { data, isLoading } = useAgentHealth();
  const services = data?.services ?? [];
  const action = isLoading ? "checking…" : formatAge(data?.checked_at);

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={TargetIcon}>Agent health</CardTitle>
        <CardAction>{action}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : services.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No services reporting.
        </div>
      ) : (
        <RowList>
          {services.map((s) => (
            <Row key={s.name}>
              <span
                className="dot"
                style={{
                  color: s.ok ? "var(--pine)" : "var(--russet)",
                  width: 7,
                  height: 7,
                }}
              />
              <span className="label-strong">{s.name}</span>
              <span className="num">{s.latency_ms}ms</span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
