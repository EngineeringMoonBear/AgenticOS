import "server-only";
import { NextResponse } from "next/server";
import { getHonchoClient } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const peerId = url.searchParams.get("peer") ?? "josh";

  try {
    const honcho = getHonchoClient();
    const peer = await honcho.peer(peerId);
    const rep = await peer.representation();
    return NextResponse.json({ peer: peerId, representation: rep });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
