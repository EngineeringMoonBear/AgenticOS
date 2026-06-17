"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { IconBtn } from "@/components/ui/IconBtn";

interface RecentErrorRow {
  id: string;
  kind: string;
  error: string | null;
  started_at: string;
}

function formatRelative(ts: string, now: Date = new Date()): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const diffSec = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  const mins = diffSec / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  return `${Math.floor(days)}d ago`;
}

function shortId(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

async function retryTask(id: string): Promise<void> {
  await fetch(`/api/tasks/${id}/retry`, { method: "POST" }).catch(() => {});
}

const AlertIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.4 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <circle cx="12" cy="17" r="0.7" fill="currentColor" />
  </svg>
);

const RetryIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="3 4 3 10 9 10" />
    <path d="M3.5 14a8 8 0 1 0 2-8.5L3 10" />
  </svg>
);

interface RecentErrorsPanelProps {
  /** Hide the per-row retry button. Pass false on the Paperclip path — the
   *  Hermes DELETE endpoint it targets does not exist in Paperclip. */
  showRetryButton?: boolean;
}

export function RecentErrorsPanel({ showRetryButton = true }: RecentErrorsPanelProps) {
  const { data, isLoading } = useQuery<{ rows: RecentErrorRow[] }>({
    queryKey: ["tasks", "recent-errors"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/recent-errors");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const rows = data?.rows ?? [];

  return (
    <Card lane="russet">
      <CardHead>
        <CardTitle icon={AlertIcon}>Recent errors</CardTitle>
        <CardAction>last 24h</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No failed tasks.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {rows.map((r) => (
            <div key={r.id} className="err-row">
              <div className="id">{shortId(r.id)}</div>
              <div className="msg">
                <span className="kind">{r.kind}</span>
                {r.error ?? ""}
              </div>
              <div className="ts">{formatRelative(r.started_at)}</div>
              {showRetryButton && (
                <IconBtn
                  variant="alert"
                  ariaLabel={`Retry ${r.kind}`}
                  onClick={() => retryTask(r.id)}
                >
                  {RetryIcon}
                </IconBtn>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
