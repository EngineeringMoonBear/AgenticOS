/**
 * GET /api/approvals
 *
 * Paperclip-backed pending approvals endpoint.
 *
 * Paperclip branch: calls approvals({ status: "pending" }) and maps to the
 * dashboard ApprovalRow shape. Only "pending" approvals are returned.
 * Non-paperclip branch: returns an empty list so the panel renders empty
 * prior to the data-source flip.
 *
 * Response shape:
 *   { approvals: Array<{ id, type, requestedBy, status }> }
 *
 * `requestedBy` ← requestedByAgentId ?? requestedByUserId ?? null
 *                 Never fabricated — null fields yield null, not a placeholder.
 *
 * `payload` is always "[redacted]" from the API — NOT included in the response.
 *
 * Approval statuses: "pending" | "revision_requested" | "approved" | "rejected" | "cancelled"
 * Approval types: "hire_agent" | "approve_ceo_strategy" | "budget_override_required" | "request_board_approval"
 *
 * On any upstream failure → 503 { error: string }
 * On missing env config   → 503 { error: string }
 */

import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { Approval } from "@/lib/paperclip/client";

export const runtime = "nodejs";

export interface ApprovalRow {
  id: string;
  /** ApprovalType enum value */
  type: string;
  /** requestedByAgentId ?? requestedByUserId ?? null */
  requestedBy: string | null;
  status: string;
}

function mapApproval(approval: Approval): ApprovalRow {
  return {
    id: approval.id,
    type: approval.type,
    requestedBy: approval.requestedByAgentId ?? approval.requestedByUserId ?? null,
    status: approval.status,
  };
}

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    return NextResponse.json({ approvals: [] });
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
  // Pass status=pending so the server filters for us; we also filter client-side
  // as a safeguard in case the server returns extras.
  const result = await client.approvals({ status: "pending" });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  const approvals = result.data
    .filter((a) => a.status === "pending")
    .map(mapApproval);

  return NextResponse.json({ approvals });
}
