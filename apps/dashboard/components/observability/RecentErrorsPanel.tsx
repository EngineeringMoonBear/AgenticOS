"use client";
import { useQuery } from "@tanstack/react-query";

interface RecentErrorRow {
  id: string;
  kind: string;
  error: string | null;
  started_at: string;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RecentErrorsPanel() {
  const { data, isLoading } = useQuery<{ rows: RecentErrorRow[] }>({
    queryKey: ["tasks", "recent-errors"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/recent-errors");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="p-4 space-y-3 border rounded-md">
      <h3 className="text-sm font-medium">Recent errors</h3>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No failed tasks.</div>
      ) : (
        <ul className="space-y-2 text-xs">
          {data.rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 border-b pb-2 last:border-b-0 last:pb-0"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted-foreground truncate">
                  {r.id}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                  {formatTimestamp(r.started_at)}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{r.kind}</span>
                {r.error ? (
                  <span className="text-muted-foreground truncate">{r.error}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
