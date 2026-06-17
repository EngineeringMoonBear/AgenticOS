/**
 * GET /api/costs?from=<iso>&to=<iso>
 *
 * Paperclip-backed cost summary endpoint. This is an ADDITIVE route —
 * it does not replace the existing Hermes-backed /api/cost/[scope] routes.
 * Wiring of dashboard consumers happens in a later task behind a feature flag.
 *
 * Response shape:
 *   {
 *     totalCents:  number,   // spendCents from Paperclip costSummary
 *     budgetCents: number,   // budgetCents from Paperclip costSummary
 *     byModel:     Array<{ provider: string; model: string; costCents: number }>
 *   }
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { createPaperclipClient } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
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

  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const params = { from, to };

  const [summaryResult, byModelResult] = await Promise.all([
    client.costSummary(params),
    client.costByAgentModel(params),
  ]);

  if (!summaryResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costSummary failed: ${summaryResult.error}` },
      { status: 503 },
    );
  }

  if (!byModelResult.ok) {
    return NextResponse.json(
      { error: `Paperclip costByAgentModel failed: ${byModelResult.error}` },
      { status: 503 },
    );
  }

  const { spendCents, budgetCents } = summaryResult.data;

  const byModel = byModelResult.data.map((row) => ({
    provider: row.provider,
    model: row.model,
    costCents: row.costCents,
  }));

  return NextResponse.json({ totalCents: spendCents, budgetCents, byModel });
}
