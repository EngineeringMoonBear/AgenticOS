"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";

type IngestStatus = "ok" | "err";

interface IngestRun {
  id: string;
  time_label: string;
  detail: string;
  status: IngestStatus;
  duration_label: string;
}

interface IngestRecentData {
  schedule: string;
  runs: IngestRun[];
}

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

function useIngestRecent() {
  return useQuery<IngestRecentData>({
    queryKey: ["ingest", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/ingest/recent");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function VaultIngestPanel() {
  const { data, isLoading } = useIngestRecent();

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={FolderIcon}>Vault ingest</CardTitle>
        <CardAction>{data?.schedule ?? "hourly"}</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <RowList>
          {data.runs.map((r) => (
            <Row key={r.id}>
              <Pill variant={r.status === "ok" ? "ok" : "err"}>
                {r.status === "ok" ? "ok" : "failed"}
              </Pill>
              <div>
                <div className="label-strong" style={{ fontSize: 12.5 }}>
                  {r.time_label} · {r.detail}
                </div>
                <div
                  className="meta"
                  style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}
                >
                  {r.id}
                </div>
              </div>
              <span className="num muted">{r.duration_label}</span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
