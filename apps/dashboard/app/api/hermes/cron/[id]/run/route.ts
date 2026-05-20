import { NextResponse } from "next/server";
import { triggerSchedule } from "@/lib/scheduler/scheduler";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const run = await triggerSchedule(id);
    return NextResponse.json(run);
  } catch (err) {
    if ((err as Error).message?.includes("not found")) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    console.error("/api/hermes/cron/[id]/run failed:", err);
    return NextResponse.json({ error: "Failed to trigger schedule" }, { status: 503 });
  }
}
