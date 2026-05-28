"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";

type VaultChangeKind = "updated" | "created";

interface VaultChange {
  path: string;
  kind: VaultChangeKind;
  time_label: string;
}

interface VaultRecentChangesData {
  source: string;
  checked_at: string;
  changes: VaultChange[];
}

const FileChangedIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M9 14l2 2 4-4" />
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

function useVaultRecentChanges() {
  return useQuery<VaultRecentChangesData>({
    queryKey: ["vault", "recent-changes"],
    queryFn: async () => {
      const res = await fetch("/api/vault/recent-changes");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

export function RecentVaultChangesPanel() {
  const { data, isLoading } = useVaultRecentChanges();
  const action = data
    ? `${data.source} · ${formatAge(data.checked_at)}`
    : "syncthing";

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={FileChangedIcon}>Recent vault changes</CardTitle>
        <CardAction>{action}</CardAction>
      </CardHead>
      {isLoading || !data ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : (
        <RowList>
          {data.changes.map((c) => (
            <Row
              key={c.path}
              style={{ gridTemplateColumns: "auto 1fr auto", gap: 8 }}
            >
              <Pill
                variant={c.kind === "created" ? "run" : "ok"}
                showDot={false}
              >
                {c.kind}
              </Pill>
              <div>
                <div
                  className="label-strong"
                  style={{ fontSize: 12, fontFamily: "var(--mono)" }}
                >
                  {c.path}
                </div>
              </div>
              <span
                className="ts"
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--parchment-faint)",
                }}
              >
                {c.time_label}
              </span>
            </Row>
          ))}
        </RowList>
      )}
    </Card>
  );
}
