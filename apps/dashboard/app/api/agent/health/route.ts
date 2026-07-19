import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent";
import { dataSource } from "@/lib/config/data-source";
import { synthesizePaperclipHealth } from "@/lib/health/paperclip-health";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paperclip synthesis path
// Guarded by dataSource() === "paperclip" (reads DASHBOARD_DATA_SOURCE).
// The synthesis itself lives in lib/health/paperclip-health.ts (shared with
// /api/health/services); this function maps it back to the response contract
// this route has always exposed.
// ---------------------------------------------------------------------------

async function getPaperclipHealth(): Promise<Response> {
  const synthesis = await synthesizePaperclipHealth();

  switch (synthesis.status) {
    case "unconfigured":
      return NextResponse.json({ error: synthesis.error }, { status: 503 });

    case "down":
      return NextResponse.json(
        { status: "down", paperclip: { reachable: false, error: synthesis.error } },
        { status: 503 },
      );

    case "degraded":
      if (synthesis.error !== undefined) {
        // Agents listing failed.
        return NextResponse.json(
          { status: "degraded", paperclip: { reachable: true, error: synthesis.error } },
          { status: 503 },
        );
      }
      if (synthesis.stuck) {
        return NextResponse.json(
          {
            status: "degraded",
            paperclip: {
              reachable: true,
              runningAgents: synthesis.runningAgents,
              stuck: true,
            },
          },
          { status: 503 },
        );
      }
      // No agents are running — system is reachable but not actively processing.
      return NextResponse.json(
        { status: "degraded", paperclip: { reachable: true, runningAgents: 0 } },
        { status: 503 },
      );

    case "ok":
      return NextResponse.json({
        status: "ok",
        paperclip: { reachable: true, runningAgents: synthesis.runningAgents },
      });
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipHealth();
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
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
