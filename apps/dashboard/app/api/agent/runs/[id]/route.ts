import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { RunRecord } from "@/lib/agent";
import { dataSource } from "@/lib/config/data-source";
import { mapToRunRecord } from "@/lib/paperclip/run-mapping";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipRun(id: string): Promise<Response> {
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

  const result = await client.heartbeatRun(id);

  if (!result.ok) {
    // Paperclip returns 404 (with body "Heartbeat run not found") for unknown ids.
    // fetchJson surfaces that as an "HTTP 404 ..." error string.
    if (/HTTP 404\b|not[ _-]?found/i.test(result.error)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Paperclip heartbeatRun failed: ${result.error}` },
      { status: 503 },
    );
  }

  return NextResponse.json(mapToRunRecord(result.data));
}

// ---------------------------------------------------------------------------
// Hermes branch (original — byte-for-byte)
// ---------------------------------------------------------------------------

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

async function getHermesRun(id: string): Promise<Response> {
  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const run = RunRecord.parse(JSON.parse(line));
        if (run.id === id) return NextResponse.json(run);
      } catch { /* skip */ }
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (dataSource() === "paperclip") {
    return getPaperclipRun(id);
  }

  return getHermesRun(id);
}
