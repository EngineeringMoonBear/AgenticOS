import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RunRecord } from "@/lib/agent";
import { dataSource } from "@/lib/config/data-source";
import { mapToRunRecord } from "@/lib/paperclip/run-mapping";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipRuns(limit: number): Promise<Response> {
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

  const result = await client.heartbeatRuns({ limit });

  if (!result.ok) {
    return NextResponse.json(
      { error: `Paperclip heartbeatRuns failed: ${result.error}` },
      { status: 503 },
    );
  }

  const runs = result.data.map(mapToRunRecord);
  return NextResponse.json({ runs });
}

// ---------------------------------------------------------------------------
// Hermes branch (original — byte-for-byte)
// ---------------------------------------------------------------------------

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

async function getHermesRuns(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const recent = lines.slice(-limit).reverse();
    const runs = recent
      .map((line) => {
        try {
          return RunRecord.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((r): r is z.infer<typeof RunRecord> => r !== null);
    return NextResponse.json({ runs });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ runs: [] });
    }
    return NextResponse.json(
      { runs: [], error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (dataSource() === "paperclip") {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    return getPaperclipRuns(limit);
  }

  return getHermesRuns(req);
}
