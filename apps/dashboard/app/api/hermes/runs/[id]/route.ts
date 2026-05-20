import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const client = await getHermesClient();
    const run = await client.getRun(id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (err) {
    console.error("/api/hermes/runs/[id] failed:", err);
    return NextResponse.json({ error: "Failed to read run" }, { status: 503 });
  }
}
