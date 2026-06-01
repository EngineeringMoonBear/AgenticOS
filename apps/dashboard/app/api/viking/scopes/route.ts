import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Short timeout so a down/unreachable OpenViking never hangs the dashboard. */
const VIKING_TIMEOUT_MS = 2000;

export interface VikingScopes {
  reachable: boolean;
  total: number;
  scopes: Record<string, number>;
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.OPENVIKING_URL;
  if (!baseUrl) {
    return NextResponse.json({ reachable: false, total: 0, scopes: {} });
  }
  try {
    // Every /api/v1/* endpoint requires Bearer auth. See
    // docs/superpowers/specs/spec1-verified-api-shapes.md §4.
    const res = await fetch(`${baseUrl}/api/v1/stats/memories`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENVIKING_ROOT_API_KEY ?? ""}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(VIKING_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json({ reachable: false, total: 0, scopes: {} });
    }
    const body = (await res.json().catch(() => ({}))) as {
      counts?: Record<string, number>;
    };
    const scopes = body.counts ?? {};
    const total = Object.values(scopes).reduce((acc, n) => acc + n, 0);
    return NextResponse.json({ reachable: true, total, scopes });
  } catch {
    return NextResponse.json({ reachable: false, total: 0, scopes: {} });
  }
}
