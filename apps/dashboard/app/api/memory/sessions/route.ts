import "server-only";
import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 100);

  try {
    const honcho = getHonchoClient();
    const page = await honcho.sessions({ size: limit });
    return NextResponse.json({ sessions: page });
  } catch (err) {
    return NextResponse.json(
      { sessions: [], error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
