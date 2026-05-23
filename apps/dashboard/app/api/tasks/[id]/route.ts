import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent/hermes-client";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const client = getHermesClient();
  try {
    const task = await client.getTask(id);
    return NextResponse.json(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("404")) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }
}
