import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();
  try {
    const hermes = getHermesClient();
    // Lightweight reachability check against Hermes task list.
    await hermes.listTasks({ limit: 1 });
    return NextResponse.json({
      status: "ok",
      hermes: { reachable: true, latencyMs: Date.now() - start },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      {
        status: "degraded",
        hermes: { reachable: false, error: message, latencyMs: Date.now() - start },
      },
      { status: 503 },
    );
  }
}
