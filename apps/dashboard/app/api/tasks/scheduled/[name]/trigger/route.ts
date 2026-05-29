import { NextResponse } from "next/server";

// TODO: wire to real scheduler-trigger endpoint.

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return NextResponse.json(
    { error: "not_implemented", message: "Manual trigger not yet wired." },
    { status: 501 },
  );
}
