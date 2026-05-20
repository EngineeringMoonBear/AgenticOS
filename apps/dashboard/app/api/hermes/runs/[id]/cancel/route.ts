import { NextResponse } from "next/server";
import { z } from "zod";
import { getHermesClient } from "@/lib/hermes/client-singleton";
import { HermesRunNotFoundError } from "@agenticos/hermes-client";

const CancelSchema = z.object({ reason: z.string().max(64).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown = {};
  try { body = (await req.text()) ? await req.json() : {}; } catch { /* empty body ok */ }
  const parsed = CancelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const client = await getHermesClient();
    await client.cancelRun(id, parsed.data.reason);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HermesRunNotFoundError) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    console.error("/api/hermes/runs/[id]/cancel failed:", err);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 503 });
  }
}
