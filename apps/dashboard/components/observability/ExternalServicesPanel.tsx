"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";

interface ExternalService {
  name: string;
  status: string;
  ok: boolean;
}

interface ExternalServicesData {
  services: ExternalService[];
  checked_at: string;
}

const GlobeIcon = (
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
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M12 3 C 8 7, 8 17, 12 21 C 16 17, 16 7, 12 3 Z" />
  </svg>
);

function formatAge(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `checked ${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `checked ${m}m ago`;
  const h = Math.floor(m / 60);
  return `checked ${h}h ago`;
}

function useExternalServices() {
  return useQuery<ExternalServicesData>({
    queryKey: ["health", "external"],
    queryFn: async () => {
      const res = await fetch("/api/health/external");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function ExternalServicesPanel() {
  const { data, isLoading } = useExternalServices();
  const services = data?.services ?? [];
  const action = isLoading ? "checking…" : formatAge(data?.checked_at);

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={GlobeIcon}>External services</CardTitle>
        <CardAction>{action}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : services.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No external services configured.
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
              <span className="num">{s.status}</span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
