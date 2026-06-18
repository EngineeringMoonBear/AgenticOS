/**
 * GET /api/org
 *
 * Paperclip-backed org tree endpoint.
 *
 * Paperclip branch: calls org() and returns the recursive OrgNode[] tree as-is.
 * The tree is nested (each node has reports: OrgNode[]) — NOT a flat list.
 * Non-paperclip branch: returns { org: null } so the panel renders empty
 * prior to the data-source flip.
 *
 * Response shape:
 *   { org: OrgNode[] | null }
 *
 * OrgNode: { id, name, role, status, reports: OrgNode[] }  (recursive)
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";

export const runtime = "nodejs";

// Re-export OrgNode so tests can import the type from the route.
export type { OrgNode } from "@/lib/paperclip/client";

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    return NextResponse.json({ org: null });
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
  const result = await client.org();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json({ org: result.data });
}
