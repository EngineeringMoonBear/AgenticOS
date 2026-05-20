import { NextResponse } from "next/server";
import { z } from "zod";
import { readSchedules, writeSchedule } from "@/lib/scheduler/cron-io";

const CreateSchema = z.object({
  id:                    z.string().min(1).max(64),
  skillId:               z.string().min(1).max(64),
  schedule:              z.string().min(1).max(128),
  enabled:               z.boolean().default(true),
  stalenessThresholdMs:  z.number().int().positive().default(300_000),
});

export async function GET() {
  try {
    const schedules = await readSchedules();
    return NextResponse.json({ schedules });
  } catch (err) {
    console.error("/api/hermes/cron GET failed:", err);
    return NextResponse.json({ error: "Failed to read schedules" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const record = await writeSchedule(parsed.data);
    return NextResponse.json(record);
  } catch (err) {
    console.error("/api/hermes/cron POST failed:", err);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
