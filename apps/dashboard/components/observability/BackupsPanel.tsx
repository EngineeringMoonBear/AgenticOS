"use client";
import { useQuery } from "@tanstack/react-query";

import { Card, CardAction, CardHead, CardTitle } from "@/components/ui/Card";
import { Pill, type PillVariant } from "@/components/ui/Pill";
import { Row, RowList } from "@/components/ui/Row";

type BackupStatus = "ok" | "aging" | "failed";

interface BackupEntry {
  id: string;
  name: string;
  detail: string;
  age: string;
  status: BackupStatus;
}

interface BackupsData {
  backups: BackupEntry[];
  next_run: string;
}

const ShieldIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 2 L20 6 V12 C20 17, 16 21, 12 22 C8 21, 4 17, 4 12 V6 Z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const ROW_COLUMNS = "auto 1fr auto";

function pillFor(status: BackupStatus): { variant: PillVariant; label: string } {
  if (status === "ok") return { variant: "ok", label: "ok" };
  if (status === "aging") return { variant: "warn", label: "aging" };
  return { variant: "err", label: "failed" };
}

function useBackups() {
  return useQuery<BackupsData>({
    queryKey: ["health", "backups"],
    queryFn: async () => {
      const res = await fetch("/api/health/backups");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 300_000,
  });
}

export function BackupsPanel() {
  const { data, isLoading } = useBackups();
  const backups = data?.backups ?? [];

  return (
    <Card lane="pine">
      <CardHead>
        <CardTitle icon={ShieldIcon}>Backups</CardTitle>
        <CardAction>{data?.next_run ?? "—"}</CardAction>
      </CardHead>
      {isLoading ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          Loading…
        </div>
      ) : backups.length === 0 ? (
        <div className="text-sm" style={{ color: "var(--parchment-muted)" }}>
          No backups configured.
        </div>
      ) : (
        <RowList>
          {backups.map((b) => {
            const p = pillFor(b.status);
            return (
              <Row
                key={b.id}
                style={{ gridTemplateColumns: ROW_COLUMNS, gap: 10 }}
              >
                <Pill variant={p.variant}>{p.label}</Pill>
                <div>
                  <div className="label-strong" style={{ fontSize: 12.5 }}>
                    {b.name}
                  </div>
                  <div
                    className="meta"
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                    }}
                  >
                    {b.detail}
                  </div>
                </div>
                <span className="num" style={{ fontSize: 12 }}>
                  {b.age}
                </span>
              </Row>
            );
          })}
        </RowList>
      )}
    </Card>
  );
}
