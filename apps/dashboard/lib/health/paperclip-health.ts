import "server-only";

/**
 * Shared Paperclip health synthesis — the single source of truth for
 * "is the agent platform healthy?". Consumed by:
 *
 *   - /api/agent/health     (status pill; maps this back to its legacy shape)
 *   - /api/health/services  (Agent-health panel + Health vista tiles)
 *
 * The synthesis walks three real Paperclip reads:
 *
 *   1. GET /api/health                    → reachable + measured latency
 *   2. GET /companies/:id/agents          → any agent with status "running"?
 *   3. GET heartbeat runs (per running agent, limit 1)
 *                                          → latest run not "stuck"?
 *
 * Nothing is fabricated: latencyMs is Date.now() measured around the real
 * health probe, and every degradation reason is carried in the result.
 */

export type PaperclipSynthesisStatus = "ok" | "degraded" | "down" | "unconfigured";

export interface PaperclipHealthSynthesis {
  status: PaperclipSynthesisStatus;
  /** False only when the /api/health probe itself failed or env is missing. */
  reachable: boolean;
  /** Milliseconds measured around the /api/health probe; null when unreachable. */
  latencyMs: number | null;
  /** Count of agents with status "running"; null when the agents read failed. */
  runningAgents: number | null;
  /** True when agents run but every latest heartbeat run is stuck. */
  stuck: boolean;
  /** Upstream error text for the failing step, when there is one. */
  error?: string;
}

export async function synthesizePaperclipHealth(): Promise<PaperclipHealthSynthesis> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return {
      status: "unconfigured",
      reachable: false,
      latencyMs: null,
      runningAgents: null,
      stuck: false,
      error:
        "Paperclip is not configured. Set PAPERCLIP_API_URL, PAPERCLIP_BOARD_KEY, and PAPERCLIP_COMPANY_ID.",
    };
  }

  const { createPaperclipClient } = await import("@/lib/paperclip/client");
  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  // Step 1: check Paperclip health endpoint (latency measured around the call).
  const probeStart = Date.now();
  const healthResult = await client.health();
  const latencyMs = Date.now() - probeStart;

  if (!healthResult.ok) {
    return {
      status: "down",
      reachable: false,
      latencyMs: null,
      runningAgents: null,
      stuck: false,
      error: healthResult.error,
    };
  }

  // Step 2: list agents to find any that are running.
  const agentsResult = await client.agents();
  if (!agentsResult.ok) {
    return {
      status: "degraded",
      reachable: true,
      latencyMs,
      runningAgents: null,
      stuck: false,
      error: agentsResult.error,
    };
  }

  const runningAgents = agentsResult.data.filter((a) => a.status === "running");

  if (runningAgents.length === 0) {
    // No agents are running — system is reachable but not actively processing.
    return {
      status: "degraded",
      reachable: true,
      latencyMs,
      runningAgents: 0,
      stuck: false,
    };
  }

  // Step 3: check whether any running agent has a non-stuck latest heartbeat
  // run. Query each running agent's own latest run in parallel using the
  // agentId filter — avoids the silent window-miss that a shared limit:50 batch
  // can produce when one busy agent consumes all 50 slots.
  const perAgentResults = await Promise.all(
    runningAgents.map((a) => client.heartbeatRuns({ agentId: a.id, limit: 1 })),
  );

  const hasHealthyRunningAgent = perAgentResults.some((result) => {
    if (!result.ok) return false;
    const latestRun = result.data[0];
    // No run returned for this agent = cannot confirm healthy.
    if (!latestRun) return false;
    return latestRun.livenessState !== "stuck";
  });

  if (hasHealthyRunningAgent) {
    return {
      status: "ok",
      reachable: true,
      latencyMs,
      runningAgents: runningAgents.length,
      stuck: false,
    };
  }

  return {
    status: "degraded",
    reachable: true,
    latencyMs,
    runningAgents: runningAgents.length,
    stuck: true,
  };
}
