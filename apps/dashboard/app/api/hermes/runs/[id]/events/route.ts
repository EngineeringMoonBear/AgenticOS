import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const client = await getHermesClient();
    const iter = client.streamRunEvents(id);
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const evt of iter) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
          }
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: "error", payload: String(err) })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });
    return new NextResponse(stream, {
      headers: {
        "content-type":  "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "connection":    "keep-alive",
      },
    });
  } catch (err) {
    console.error("/api/hermes/runs/[id]/events failed:", err);
    return NextResponse.json({ error: "Failed to open stream" }, { status: 503 });
  }
}
