"use client";
import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Row, RowList } from "@/components/ui/Row";
import { useHealthServices } from "@/lib/hooks/use-health-services";

/**
 * Agent health panel — live service probes from /api/health/services
 * (truth pass 2026-07-14; previously rendered canned "Hermes 2ms" rows).
 * Each row is a real probe: platform (Paperclip/Hermes) + OpenViking.
 * Latency is measured server-side around the actual probe; a service
 * that could not be probed shows "—" with an honest detail line.
 */

const PLACEHOLDER = "—";

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
  if (!iso) return PLACEHOLDER;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return PLACEHOLDER;
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function AgentHealthPanel() {
  const { data, isLoading } = useHealthServices();
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
              <div>
                <div className="label-strong">{s.name}</div>
                <div className="meta" style={{ fontSize: 10.5 }}>
                  {s.detail}
                </div>
              </div>
              <span className="num">
                {s.latencyMs != null ? `${s.latencyMs}ms` : PLACEHOLDER}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
