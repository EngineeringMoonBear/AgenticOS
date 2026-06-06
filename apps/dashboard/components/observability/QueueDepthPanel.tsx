"use client";
import { useQuery } from "@tanstack/react-query";

interface QueueDepthRow {
  kind: string;
  status: string;
  count: number;
}

export function QueueDepthPanel() {
  const { data, isLoading } = useQuery<{ rows: QueueDepthRow[] }>({
    queryKey: ["tasks", "queue-depth"],
    queryFn: async () => {
      const res = await fetch("/api/tasks/queue-depth");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="p-4 space-y-3 border rounded-md">
      <h3 className="text-sm font-medium">Queue depth</h3>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">No queued or running tasks.</div>
      ) : (
        <dl className="space-y-1 text-xs">
          {data.rows.map((r) => (
            <div
              key={`${r.kind}-${r.status}`}
              className="flex items-center justify-between gap-2"
            >
              <dt className="font-mono">
                {r.kind} <span className="text-muted-foreground">· {r.status}</span>
              </dt>
              <dd className="font-mono tabular-nums">{r.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
