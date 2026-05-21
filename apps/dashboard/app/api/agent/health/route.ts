import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const honcho = getHonchoClient();
    // Honcho SDK health check: workspaces() returns a paginated list (lightweight)
    await honcho.workspaces({ size: 1 });
    return NextResponse.json({
      status: "ok",
      honcho: { reachable: true, latencyMs: Date.now() - start },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      {
        status: "degraded",
        honcho: { reachable: false, error: message, latencyMs: Date.now() - start },
      },
      { status: 503 },
    );
  }
}
