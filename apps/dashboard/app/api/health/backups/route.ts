import { NextResponse } from "next/server";

// TODO: wire to real backend (Droplet health endpoints / status pages)

export const runtime = "nodejs";

export type BackupStatus = "ok" | "aging" | "failed";

export interface BackupEntry {
  id: string;
  name: string;
  detail: string;
  age: string;
  status: BackupStatus;
}

export interface BackupsData {
  backups: BackupEntry[];
  next_run: string;
}

export async function GET(): Promise<Response> {
  const data: BackupsData = {
    backups: [
      {
        id: "postgres",
        name: "Postgres dump",
        detail: "12.4 MB gz · 14:00 today",
        age: "6h ago",
        status: "ok",
      },
      {
        id: "vault",
        name: "Vault snapshot",
        detail: "syncthing · Mac mirror",
        age: "2m ago",
        status: "ok",
      },
      {
        id: "offsite",
        name: "Off-site (DO Spaces)",
        detail: "last successful: 4 days ago",
        age: "4d ago",
        status: "aging",
      },
    ],
    next_run: "next 02:00",
  };
  return NextResponse.json(data);
}
