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
  // App Platform injects OPENVIKING_ENDPOINT/OPENVIKING_API_KEY (matching the
  // Hermes plugin convention; see app-platform.tf). Fall back to the older
  // OPENVIKING_URL/OPENVIKING_ROOT_API_KEY names for local dev.
  const baseUrl = process.env.OPENVIKING_ENDPOINT ?? process.env.OPENVIKING_URL;
  if (!baseUrl) {
    return NextResponse.json({ reachable: false, total: 0, scopes: {} });
  }
  try {
    // Every /api/v1/* endpoint requires Bearer auth. See
    // docs/superpowers/specs/spec1-verified-api-shapes.md §4.
    //
    // We authenticate with the ROOT key, but stats/memories is a
    // tenant-scoped API: OpenViking rejects a root key (400 INVALID_ARGUMENT)
    // unless the request names the tenant explicitly via X-OpenViking-Account
    // + X-OpenViking-User. (A user-scoped key would carry an implicit tenant;
    // the root key does not.) These match the headers viking-backup.sh sends
    // and the OPENVIKING_ACCOUNT/USER env we set on App Platform.
    const res = await fetch(`${baseUrl}/api/v1/stats/memories`, {
      headers: {
        Authorization: `Bearer ${process.env.OPENVIKING_API_KEY ?? process.env.OPENVIKING_ROOT_API_KEY ?? ""}`,
        "X-OpenViking-Account": process.env.OPENVIKING_ACCOUNT ?? "agenticos",
        "X-OpenViking-User": process.env.OPENVIKING_USER ?? "deploy",
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
