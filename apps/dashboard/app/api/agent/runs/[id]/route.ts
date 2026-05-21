import "server-only";
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { RunRecord } from "@/lib/agent";

export const dynamic = "force-dynamic";

const RUNS_PATH = process.env.AGENTICOS_RUNS_PATH ?? "/var/log/agenticos/runs.jsonl";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
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
