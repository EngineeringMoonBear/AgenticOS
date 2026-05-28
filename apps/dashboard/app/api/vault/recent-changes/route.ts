import { NextResponse } from "next/server";

// TODO: wire to syncthing event log or filesystem watcher.

export const runtime = "nodejs";

export type VaultChangeKind = "updated" | "created";

export interface VaultChange {
  path: string;
  kind: VaultChangeKind;
  time_label: string;
}

export interface VaultRecentChangesData {
  source: string;
  checked_at: string;
  changes: VaultChange[];
}

export async function GET(): Promise<Response> {
  const data: VaultRecentChangesData = {
    source: "syncthing",
    checked_at: new Date().toISOString(),
    changes: [
      { path: "farming/pasture-management/rotation.md", kind: "updated", time_label: "13:45" },
      { path: "farming/soil-health/ph-zones.md", kind: "created", time_label: "11:20" },
      { path: "farming/forage/winter-stockpile.md", kind: "updated", time_label: "09:15" },
      { path: "dev/code-review-style.md", kind: "updated", time_label: "yesterday" },
    ],
  };
  return NextResponse.json(data);
}
