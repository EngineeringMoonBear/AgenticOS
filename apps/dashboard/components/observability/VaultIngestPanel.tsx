"use client";
import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill, type PillVariant } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";
import { useIngestRecent } from "@/lib/hooks/use-ingest-recent";
import type { IngestRun } from "@/app/api/ingest/recent/route";

/**
 * Vault ingest panel — recent vault-ingest task rows from Postgres via
 * /api/ingest/recent (truth pass 2026-07-14; previously rendered three
 * canned runs). Time, status, and duration all derive from the real
 * `tasks` telemetry columns; duration shows "—" while a run is still going.
 */

const PLACEHOLDER = "—";

const FolderIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-8l-2-2H5a2 2 0 0 0-2 2z" />
    <path d="M7 14h10M7 10h10" />
  </svg>
);

function pillFor(status: string): { variant: PillVariant; label: string } {
  switch (status) {
    case "done":
      return { variant: "ok", label: "ok" };
    case "failed":
      return { variant: "err", label: "failed" };
    case "running":
      return { variant: "run", label: "running" };
    default:
      return { variant: "warn", label: status };
  }
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return PLACEHOLDER;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function durationLabel(run: IngestRun): string {
  if (!run.ended_at) return PLACEHOLDER;
  const start = new Date(run.started_at).getTime();
  const end = new Date(run.ended_at).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return PLACEHOLDER;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms - min * 60_000) / 1000);
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

export function VaultIngestPanel() {
  const { data, isLoading } = useIngestRecent();

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={FolderIcon}>Vault ingest</CardTitle>
        <CardAction>
          {data?.schedule ? `cron ${data.schedule}` : PLACEHOLDER}
        </CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : data.runs.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No vault-ingest runs recorded.
        </div>
      ) : (
        <RowList>
          {data.runs.map((r) => {
            const pill = pillFor(r.status);
            return (
              <Row key={r.id}>
                <Pill variant={pill.variant}>{pill.label}</Pill>
                <div>
                  <div className="label-strong" style={{ fontSize: 12.5 }}>
                    {timeLabel(r.started_at)}
                    {r.error ? ` · ${r.error}` : ""}
                  </div>
                  <div
                    className="meta"
                    style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                  >
                    {r.id}
                  </div>
                </div>
                <span className="num muted">{durationLabel(r)}</span>
              </Row>
            );
          })}
        </RowList>
      )}
    </Card>
  );
}
