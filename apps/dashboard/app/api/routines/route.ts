/**
 * GET /api/routines
 *
 * Paperclip-backed routine roster endpoint.
 *
 * Paperclip branch: calls routines() and maps to the dashboard RoutineRow shape.
 * Non-paperclip branch: returns an empty list so the panel renders empty
 * prior to the data-source flip (no Hermes equivalent for this endpoint).
 *
 * Response shape:
 *   { routines: Array<{ id, name, enabled, cron, lastResult, managedByPlugin }> }
 *
 * Field mapping:
 *   `name`            ← Routine.title
 *   `enabled`         ← Routine.status === "active"
 *   `cron`            ← first trigger's cronExpression (null when no triggers or cronExpression is null)
 *   `lastResult`      ← first trigger's lastResult (null when no triggers)
 *   `managedByPlugin` ← managedByPlugin?.pluginDisplayName ?? null
 *
 * Only real fields from the Routine interface are used; absent fields map to null.
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { Routine } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export interface RoutineRow {
  id: string;
  /** Routine.title */
  name: string;
  /** true when Routine.status === "active" */
  enabled: boolean;
  /** First trigger's cronExpression, or null when absent. */
  cron: string | null;
  /** First trigger's lastResult, or null when absent. */
  lastResult: string | null;
  /** managedByPlugin.pluginDisplayName, or null when unmanaged. */
  managedByPlugin: string | null;
}

function mapRoutine(routine: Routine): RoutineRow {
  const firstTrigger = routine.triggers.length > 0 ? routine.triggers[0] : null;

  return {
    id: routine.id,
    name: routine.title,
    enabled: routine.status === "active",
    cron: firstTrigger?.cronExpression ?? null,
    lastResult: firstTrigger?.lastResult ?? null,
    managedByPlugin: routine.managedByPlugin?.pluginDisplayName ?? null,
  };
}

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    // No Hermes equivalent — return empty list so the panel renders empty
    // before the data-source flip.
    return NextResponse.json({ routines: [] });
  }

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip config missing (PAPERCLIP_API_URL / PAPERCLIP_BOARD_KEY / PAPERCLIP_COMPANY_ID)",
      },
      { status: 503 },
    );
  }

  const client = createPaperclipClient({ apiUrl, boardKey, companyId });
  const result = await client.routines();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const routines = result.data.map(mapRoutine);
  return NextResponse.json({ routines });
}
