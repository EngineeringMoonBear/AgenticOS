import { NextResponse } from "next/server";
import { getBudget, updateBudget } from "@/lib/cost/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const budget = await getBudget();
  return NextResponse.json(budget);
}

export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json()) as {
    monthly_cap_cents?: number;
    soft_alert_pct?: number;
    reset_day_of_month?: number;
  };

  if (
    body.monthly_cap_cents !== undefined &&
    (body.monthly_cap_cents < 0 || !Number.isInteger(body.monthly_cap_cents))
  ) {
    return NextResponse.json(
      { error: "monthly_cap_cents must be a non-negative integer" },
      { status: 400 },
    );
  }
  if (
    body.soft_alert_pct !== undefined &&
    (body.soft_alert_pct < 0 || body.soft_alert_pct > 100)
  ) {
    return NextResponse.json(
      { error: "soft_alert_pct must be 0–100" },
      { status: 400 },
    );
  }
  if (
    body.reset_day_of_month !== undefined &&
    (body.reset_day_of_month < 1 || body.reset_day_of_month > 28)
  ) {
    return NextResponse.json(
      { error: "reset_day_of_month must be 1–28" },
      { status: 400 },
    );
  }

  const updated = await updateBudget(body);
  return NextResponse.json(updated);
}
