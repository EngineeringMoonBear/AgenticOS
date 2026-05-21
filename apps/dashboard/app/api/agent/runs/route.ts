import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RunRecord } from "@/lib/agent";

export const dynamic = "force-dynamic";

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  try {
    const content = await readFile(RUNS_PATH, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const recent = lines.slice(-limit).reverse();
    const runs = recent
      .map((line) => {
        try { return RunRecord.parse(JSON.parse(line)); } catch { return null; }
      })
      .filter((r): r is z.infer<typeof RunRecord> => r !== null);
    return NextResponse.json({ runs });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ runs: [] });
    }
    return NextResponse.json({ runs: [], error: (err as Error).message }, { status: 500 });
  }
}
