import { NextResponse } from "next/server";
import {
  getCostSummary,
  getTodayTasks,
  getMonthByDay,
  getMonthByKind,
} from "@/lib/cost/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ scope: string }> },
): Promise<Response> {
  const { scope } = await params;

  switch (scope) {
    case "today": {
      const [summary, tasks] = await Promise.all([
        getCostSummary(),
        getTodayTasks(),
      ]);
      return NextResponse.json({ summary, tasks });
    }
    case "month": {
      const [summary, by_day, by_kind] = await Promise.all([
        getCostSummary(),
        getMonthByDay(),
        getMonthByKind(),
      ]);
      return NextResponse.json({ summary, by_day, by_kind });
    }
    case "forecast": {
      const summary = await getCostSummary();
      return NextResponse.json({
        mtd_cents: summary.mtd_cents,
        projected_month_end_cents: summary.projected_month_end_cents,
        cap_cents: summary.cap_cents,
        pct_of_cap: summary.pct_of_cap,
      });
    }
    default:
      return NextResponse.json(
        { error: `unknown scope: ${scope}` },
        { status: 404 },
      );
  }
}
