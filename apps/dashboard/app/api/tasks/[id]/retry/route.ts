import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Retry endpoint stub — Sub-phase 3.5.6.
 *
 * Wired up by RecentErrorsPanel's retry button. Real retry semantics
 * (re-enqueue task, copy prompt/metadata, etc.) are a follow-up task.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return NextResponse.json(
    { error: "not implemented", id },
    { status: 501 },
  );
}
