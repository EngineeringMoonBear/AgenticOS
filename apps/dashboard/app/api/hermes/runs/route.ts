import { NextResponse } from "next/server";
import { z } from "zod";
import { getHermesClient } from "@/lib/hermes/client-singleton";

const DispatchSchema = z.object({
  skillId:      z.string().min(1).max(128),
  model:        z.string().optional(),
  budget:       z.number().positive().max(100).optional(),
  toolNames:    z.array(z.string()).max(50).optional(),
  systemPrompt: z.string().min(1).max(100_000),
  userPrompt:   z.string().min(1).max(100_000),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const client = await getHermesClient();
    const runs = await client.listRuns({
      limit:   url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      skillId: url.searchParams.get("skillId") ?? undefined,
      since:   url.searchParams.get("since") ?? undefined,
      status:  url.searchParams.get("status")?.split(",") as never,
    });
    return NextResponse.json({ runs });
  } catch (err) {
    console.error("/api/hermes/runs GET failed:", err);
    return NextResponse.json({ error: "Failed to list runs" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? "0") > 64 * 1024) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = DispatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const client = await getHermesClient();
    const run = await client.dispatchRun(parsed.data);
    return NextResponse.json(run);
  } catch (err) {
    console.error("/api/hermes/runs POST failed:", err);
    return NextResponse.json({ error: "Failed to dispatch run" }, { status: 503 });
  }
}
