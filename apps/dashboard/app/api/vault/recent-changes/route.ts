import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export type VaultChangeKind = "created" | "updated" | "deleted";

export interface VaultChange {
  path: string;
  kind: VaultChangeKind;
  occurredAt: string;
}

export interface VaultRecentChangesData {
  source: string;
  available: boolean;
  error?: string;
  changes: VaultChange[];
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) {
    return NextResponse.json({ source: "syncthing", available: false, changes: [] });
  }

  try {
    const res = await fetch(`${baseUrl}/recent-changes`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { source: "syncthing", available: false, error: `HTTP ${res.status}`, changes: [] },
        { status: 502 },
      );
    }
    const body = (await res.json()) as { available: boolean; changes: VaultChange[] };
    return NextResponse.json({
      source: "syncthing",
      available: body.available,
      changes: body.changes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        source: "syncthing",
        available: false,
        error: (err as Error).message,
        changes: [],
      },
      { status: 502 },
    );
  }
}
