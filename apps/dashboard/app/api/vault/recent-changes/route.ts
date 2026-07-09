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

/**
 * Bound the whole round-trip to vault-server. Its own Syncthing probe is
 * capped at 3s; 5s here gives it headroom while guaranteeing this route can
 * never hang the dashboard panel (2026-07-08 incident: an unbounded fetch
 * rode a long-polling/blackholed upstream into a gateway timeout, and the
 * panel showed "Syncthing offline" while sync itself was healthy).
 */
const FETCH_TIMEOUT_MS = 5000;

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) {
    return NextResponse.json({ source: "syncthing", available: false, changes: [] });
  }

  try {
    const res = await fetch(`${baseUrl}/recent-changes`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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
