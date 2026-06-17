/**
 * GET /api/cost/today
 *
 * Returns spend figures for the KPI banner (use-kpi-data.ts).
 *
 * Response shape (CostTodayResponse):
 *   {
 *     summary: {
 *       today_cents:     number,  // spend so far today (UTC)
 *       yesterday_cents: number,  // spend for all of yesterday (UTC)
 *       cap_cents:       number,  // monthly budget cap (0 if none configured)
 *       mtd_cents:       number,  // month-to-date spend
 *     }
 *   }
 *
 * Paperclip path: three costSummary range calls (today / yesterday / MTD).
 *   cap_cents ← budgetCents from the MTD summary.
 *   Fail-closed: any upstream error → 503 { error }.
 *
 * Hermes path (dataSource() !== "paperclip"):
 *   Returns zeroed placeholder values so the KPI banner degrades gracefully
 *   until this source is wired to the Hermes DB.
 *
 * On missing Paperclip config → 503 { error }.
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Returns UTC midnight start and end timestamps for today.
 */
function todayRange(): { from: string; to: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return {
    from: `${yyyy}-${mm}-${dd}T00:00:00Z`,
    to: now.toISOString(),
  };
}

/**
 * Returns UTC midnight start and end timestamps for yesterday.
 */
function yesterdayRange(): { from: string; to: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  return {
    from: `${dateStr}T00:00:00Z`,
    to: `${dateStr}T23:59:59Z`,
  };
}

/**
 * Returns the UTC midnight start of the current month through now.
 */
function mtdRange(): { from: string; to: string } {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return {
    from: `${yyyy}-${mm}-01T00:00:00Z`,
    to: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Paperclip path
// ---------------------------------------------------------------------------

async function getPaperclipToday(): Promise<Response> {
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

  const [todayResult, yesterdayResult, mtdResult] = await Promise.all([
    client.costSummary(todayRange()),
    client.costSummary(yesterdayRange()),
    client.costSummary(mtdRange()),
  ]);

  if (!todayResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costSummary (today) failed: ${todayResult.error}` },
      { status: 503 },
    );
  }

  if (!yesterdayResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costSummary (yesterday) failed: ${yesterdayResult.error}` },
      { status: 503 },
    );
  }

  if (!mtdResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costSummary (MTD) failed: ${mtdResult.error}` },
      { status: 503 },
    );
  }

  return NextResponse.json({
    summary: {
      today_cents: todayResult.data.spendCents,
      yesterday_cents: yesterdayResult.data.spendCents,
      // cap_cents comes from the MTD summary's budgetCents (same budget for all ranges).
      cap_cents: mtdResult.data.budgetCents,
      mtd_cents: mtdResult.data.spendCents,
    },
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipToday();
  }

  // ── Existing Hermes path ─────────────────────────────────────────────────
  // Placeholder: returns zeroed values so the KPI banner degrades gracefully.
  // The Hermes DB wiring for this route is handled separately.
  return NextResponse.json({
    summary: {
      today_cents: 0,
      yesterday_cents: 0,
      cap_cents: 0,
      mtd_cents: 0,
    },
  });
}
