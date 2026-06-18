/**
 * GET /api/agents
 *
 * Paperclip-backed agents roster endpoint.
 *
 * Paperclip branch: calls agents() and maps to the dashboard AgentRow shape.
 * Non-paperclip branch: returns an empty list so the panel renders empty
 * prior to the data-source flip (no Hermes equivalent for this endpoint).
 *
 * Response shape:
 *   { agents: Array<{ id, name, adapter, status, lastActivityAt }> }
 *
 * `adapter`         ← Agent.adapterType
 * `lastActivityAt`  ← Agent.lastHeartbeatAt (ISO string | null)
 *                     Real field from the agents fixture; null when the agent
 *                     has never heartbeated. NOT fabricated.
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { Agent } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export interface AgentRow {
  id: string;
  name: string;
  adapter: string | null;
  status: string;
  lastActivityAt: string | null;
}

function mapAgent(agent: Agent): AgentRow {
  return {
    id: agent.id,
    name: agent.name,
    adapter: agent.adapterType ?? null,
    status: agent.status,
    // lastHeartbeatAt is a real field present in the agents fixture
    // (vendor/paperclip/server/src/routes/agents.ts, agents.json).
    // It is null when the agent has never sent a heartbeat.
    lastActivityAt:
      typeof agent["lastHeartbeatAt"] === "string" ? agent["lastHeartbeatAt"] : null,
  };
}

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    // No Hermes equivalent — return empty list so the panel renders empty
    // before the data-source flip.
    return NextResponse.json({ agents: [] });
  }

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip config missing (PAPERCLIP_API_URL / PAPERCLIP_BOARD_KEY / PAPERCLIP_COMPANY_ID)",
      },
      { status: 503 },
    );
  }

  const client = createPaperclipClient({ apiUrl, boardKey, companyId });
  const result = await client.agents();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const agents = result.data.map(mapAgent);
  return NextResponse.json({ agents });
}
