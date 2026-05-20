import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSchedule, updateSchedule } from "@/lib/scheduler/cron-io";

const PatchSchema = z.object({
  schedule:              z.string().min(1).max(128).optional(),
  enabled:               z.boolean().optional(),
  stalenessThresholdMs:  z.number().int().positive().optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const record = await updateSchedule(id, parsed.data);
    if (!record) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    return NextResponse.json(record);
  } catch (err) {
    console.error("/api/hermes/cron/[id] PUT failed:", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteSchedule(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("/api/hermes/cron/[id] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
