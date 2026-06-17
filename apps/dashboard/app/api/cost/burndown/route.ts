import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";

export const runtime = "nodejs";

export interface BurndownPoint {
  at: string;
  cents: number;
}

export type BurndownRange = "24h" | "30d";

// Maximum number of per-day costSummary calls for the burndown fan-out.
const MAX_DAYS = 31;

/**
 * Returns an ISO date string (YYYY-MM-DD) for a UTC date offset by `offset`
 * days from today. offset=0 → today, offset=1 → yesterday, etc.
 */
function utcDateOffset(offset: number): { from: string; to: string } {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  return { from: `${dateStr}T00:00:00Z`, to: `${dateStr}T23:59:59Z` };
}

// ---------------------------------------------------------------------------
// Paperclip path — per-day costSummary fan-out
// ---------------------------------------------------------------------------

async function getPaperclipBurndown(range: BurndownRange): Promise<Response> {
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

  // 24h → 1 day (today only); 30d → up to MAX_DAYS days.
  const numDays = range === "24h" ? 1 : MAX_DAYS;

  // Build the date offsets from oldest → newest (offset numDays-1 down to 0).
  const offsets: number[] = [];
  for (let i = numDays - 1; i >= 0; i--) {
    offsets.push(i);
  }

  const points: BurndownPoint[] = [];

  for (const offset of offsets) {
    const { from, to } = utcDateOffset(offset);
    const result = await client.costSummary({ from, to });

    if (!result.ok) {
      return NextResponse.json(
        { error: `Paperclip costSummary failed for day offset ${offset}: ${result.error}` },
        { status: 503 },
      );
    }

    // `at` is the UTC midnight ISO string for this day bucket.
    const at = from.slice(0, 10);
    points.push({ at, cents: result.data.spendCents });
  }

  return NextResponse.json({ range, bucket: "day", points });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get("range");
  const range: BurndownRange = rangeParam === "30d" ? "30d" : "24h";

  if (dataSource() === "paperclip") {
    return getPaperclipBurndown(range);
  }

  // ── Existing Hermes logic (unchanged) ────────────────────────────────────
  const { getPool } = await import("@/lib/cost/db");
  const pool = getPool();
  const bucket = range === "30d" ? "day" : "hour";
  const interval = range === "30d" ? "30 days" : "24 hours";

  const { rows } = await pool.query<{ at: string; cents: number }>(
    `
      SELECT date_trunc($1, occurred_at)::text AS at,
             COALESCE(SUM(cost_cents), 0)::int AS cents
      FROM calls
      WHERE occurred_at >= now() - ($2)::interval
      GROUP BY 1
      ORDER BY 1
    `,
    [bucket, interval],
  );

  return NextResponse.json({ range, bucket, points: rows });
}
