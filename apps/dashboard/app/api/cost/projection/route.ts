import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";

export const runtime = "nodejs";

export interface CostProjectionData {
  spend_usd: number;
  cap_usd: number;
  mtd_spend_usd: number;
  avg_per_day_usd: number;
  days_remaining: number;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Returns the day-of-month for today (1-based, UTC). */
function utcDayOfMonth(): number {
  return new Date().getUTCDate();
}

/** Returns the number of days in the current UTC month. */
function utcDaysInMonth(): number {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Returns an ISO date string for the start of the current UTC month. */
function utcMonthStart(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01T00:00:00Z`;
}

/** Returns an ISO date string for the current UTC moment (end of today). */
function utcNow(): string {
  return new Date().toISOString();
}

/**
 * Returns an ISO date string for the start of `offset` days ago (UTC midnight).
 * offset=0 → today, offset=6 → 6 days ago.
 */
function utcDateOffsetStart(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

// ---------------------------------------------------------------------------
// Paperclip path
// ---------------------------------------------------------------------------

async function getPaperclipProjection(): Promise<Response> {
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

  // MTD summary — spendCents is the month-to-date total, budgetCents is the cap.
  const mtdResult = await client.costSummary({
    from: utcMonthStart(),
    to: utcNow(),
  });

  if (!mtdResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costSummary (MTD) failed: ${mtdResult.error}` },
      { status: 503 },
    );
  }

  const { spendCents, budgetCents } = mtdResult.data;

  const dayOfMonth = utcDayOfMonth();
  const daysInMonth = utcDaysInMonth();
  const daysElapsed = Math.max(dayOfMonth, 1);

  // 7-day rolling average (capped to elapsed days so we don't divide by more days
  // than have passed this month).
  const avgWindowDays = Math.min(7, daysElapsed);

  let avgPerDayUsd: number;

  if (avgWindowDays <= 1) {
    // Only today (or first day of month): use today's spend directly.
    avgPerDayUsd = spendCents / 100 / daysElapsed;
  } else {
    // Fetch the 7-day window to compute avg.
    const windowResult = await client.costSummary({
      from: utcDateOffsetStart(avgWindowDays - 1),
      to: utcNow(),
    });

    if (!windowResult.ok) {
      return NextResponse.json(
        { error: `Paperclip costSummary (7d window) failed: ${windowResult.error}` },
        { status: 503 },
      );
    }

    avgPerDayUsd = windowResult.data.spendCents / 100 / avgWindowDays;
  }

  const daysRemaining = Math.max(0, daysInMonth - dayOfMonth);
  const spendUsd = spendCents / 100;
  const capUsd = budgetCents / 100;

  const data: CostProjectionData = {
    spend_usd: spendUsd,
    cap_usd: capUsd,
    mtd_spend_usd: spendUsd,
    avg_per_day_usd: Math.round(avgPerDayUsd * 100) / 100,
    days_remaining: daysRemaining,
  };

  return NextResponse.json(data);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  if (dataSource() === "paperclip") {
    return getPaperclipProjection();
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
  // TODO: derive from real spend history + cap config.
  const data: CostProjectionData = {
    spend_usd: 47.74,
    cap_usd: 200,
    mtd_spend_usd: 46.18,
    avg_per_day_usd: 1.54,
    days_remaining: 3,
  };
  return NextResponse.json(data);
}
