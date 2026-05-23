import { NextRequest, NextResponse } from "next/server";
import { getHermesClient } from "@/lib/agent/hermes-client";
import type { CreateTaskInput } from "@/lib/agent/types";

// Force Node runtime — we use pg pool indirectly via Hermes-client server-only imports.
export const runtime = "nodejs";

export async function GET(req: NextRequest | Request): Promise<Response> {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const limit = url.searchParams.get("limit");

  const client = getHermesClient();
  const tasks = await client.listTasks({
    since: since ? new Date(since) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return NextResponse.json(tasks);
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as CreateTaskInput;
  if (!body.kind || !body.prompt) {
    return NextResponse.json(
      { error: "kind and prompt required" },
      { status: 400 },
    );
  }
  const client = getHermesClient();
  const task = await client.createTask(body);
  return NextResponse.json(task, { status: 201 });
}
