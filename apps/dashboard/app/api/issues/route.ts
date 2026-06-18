/**
 * GET /api/issues
 *
 * Paperclip-backed issues / work-queue endpoint.
 *
 * Paperclip branch: calls issues() and maps to the dashboard IssueRow shape.
 * Non-paperclip branch: returns an empty list — no Hermes equivalent for this
 * endpoint exists. The panel renders empty until the data-source flip.
 *
 * Response shape:
 *   { issues: Array<{ id, title, status, assignee, priority }> }
 *
 * `assignee` ← assigneeAgentId ?? assigneeUserId ?? null
 *   - The real Issue type has two separate nullable FK fields; we coalesce them
 *     into a single opaque id string (or null). Agent id takes precedence.
 *   - Render "unassigned" in the UI when null — do NOT fabricate a name.
 *
 * `priority`  ← Issue.priority (string | null — real field per SHAPES.md)
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { Issue } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export interface IssueRow {
  id: string;
  title: string;
  status: string;
  /** Coalesced from assigneeAgentId ?? assigneeUserId. Null → "unassigned" in UI. */
  assignee: string | null;
  /** From Issue.priority — string enum per constants.ts, or null when unset. */
  priority: string | null;
}

function mapIssue(issue: Issue): IssueRow {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    // Agent id takes precedence over user id; both null → null.
    assignee: issue.assigneeAgentId ?? issue.assigneeUserId ?? null,
    priority: issue.priority ?? null,
  };
}

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    // No Hermes equivalent — return empty list so the panel renders empty
    // before the data-source flip.
    return NextResponse.json({ issues: [] });
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
  const result = await client.issues({});

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const issues = result.data.map(mapIssue);
  return NextResponse.json({ issues });
}
