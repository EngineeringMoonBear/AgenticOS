import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paperclip synthesis path
// Guarded by DASHBOARD_DATA_SOURCE === "paperclip".
// TODO (Task 1.5): replace this inline check with a shared dataSource()
// helper once the feature-flag module is introduced.
// ---------------------------------------------------------------------------

async function getPaperclipHealth(): Promise<Response> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip is not configured. Set PAPERCLIP_API_URL, PAPERCLIP_BOARD_KEY, and PAPERCLIP_COMPANY_ID.",
      },
      { status: 503 },
    );
  }

  const { createPaperclipClient } = await import("@/lib/paperclip/client");
  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  // Step 1: check Paperclip health endpoint.
  const healthResult = await client.health();
  if (!healthResult.ok) {
    return NextResponse.json(
      { status: "down", paperclip: { reachable: false, error: healthResult.error } },
      { status: 503 },
    );
  }

  // Step 2: list agents to find any that are running.
  const agentsResult = await client.agents();
  if (!agentsResult.ok) {
    return NextResponse.json(
      { status: "degraded", paperclip: { reachable: true, error: agentsResult.error } },
      { status: 503 },
    );
  }

  const runningAgents = agentsResult.data.filter((a) => a.status === "running");

  if (runningAgents.length === 0) {
    // No agents are running — system is reachable but not actively processing.
    return NextResponse.json(
      {
        status: "degraded",
        paperclip: { reachable: true, runningAgents: 0 },
      },
      { status: 503 },
    );
  }

  // Step 3: check whether any running agent has a stuck latest heartbeat run.
  // We only need to know if at least one agent is healthy, so we check heartbeat
  // runs for all running agents in parallel and consider the system "ok" if any
  // running agent's latest run is not stuck.
  const heartbeatChecks = await Promise.all(
    runningAgents.map((agent) =>
      client.heartbeatRuns({ limit: 1 }).then((result) => ({ agent, result })),
    ),
  );

  const hasHealthyRunningAgent = heartbeatChecks.some(({ result }) => {
    if (!result.ok) return false;
    const latestRun = result.data[0];
    // No runs found = we cannot confirm healthy.
    if (!latestRun) return false;
    return latestRun.livenessState !== "stuck";
  });

  if (hasHealthyRunningAgent) {
    return NextResponse.json({
      status: "ok",
      paperclip: { reachable: true, runningAgents: runningAgents.length },
    });
  }

  return NextResponse.json(
    {
      status: "degraded",
      paperclip: { reachable: true, runningAgents: runningAgents.length, stuck: true },
    },
    { status: 503 },
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  // Inline data-source guard — Task 1.5 will refactor to a shared dataSource()
  // helper. Until then, any value other than "paperclip" falls through to Hermes.
  if (process.env.DASHBOARD_DATA_SOURCE === "paperclip") {
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
