import "server-only";
import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import type { HeartbeatRunEvent } from "@/lib/paperclip/client";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// The UI hook (lib/hooks/use-run-events.ts) consumes this route with an
// EventSource and expects a `text/event-stream`. Each SSE message's `data:`
// payload is a JSON-encoded RunEvent:
//
//   interface RunEvent { ts: string; kind: string; payload: unknown }
//
// Paperclip → RunEvent field mapping (vendor heartbeat_run_events schema):
//   ts      ← createdAt   (event timestamp)
//   kind    ← eventType   (e.g. "lifecycle", "stdout", ...)
//   payload ← payload     (already redacted server-side by redactEventPayload)
//
// Fields Paperclip carries but RunEvent does not surface (seq, stream, level,
// color, message, agentId, companyId) are intentionally dropped — RunEvent has
// no slot for them. Nothing is fabricated.
//
// Paperclip's /events endpoint returns a one-shot JSON array (not a live
// stream), so we emit each event as one SSE message and then close. The hook's
// EventSource.onerror handler closes the connection on stream end, so this is
// a complete, non-reconnecting snapshot.
// ---------------------------------------------------------------------------

interface RunEvent {
  ts: string;
  kind: string;
  payload: unknown;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-store",
  Connection: "keep-alive",
} as const;

function sseStream(events: RunEvent[]): Response {
  const encoder = new TextEncoder();
  const body = events
    .map((evt) => `data: ${JSON.stringify(evt)}\n\n`)
    .join("");
  return new Response(encoder.encode(body), { headers: SSE_HEADERS });
}

function mapEvent(event: HeartbeatRunEvent): RunEvent {
  return {
    ts: event.createdAt,
    kind: event.eventType,
    payload: event.payload,
  };
}

// ---------------------------------------------------------------------------
// Paperclip branch
// ---------------------------------------------------------------------------

async function getPaperclipRunEvents(id: string): Promise<Response> {
  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      {
        error:
          "Paperclip is not configured. Set PAPERCLIP_API_URL, PAPERCLIP_BOARD_KEY, and PAPERCLIP_COMPANY_ID.",
      },
      { status: 503 },
    );
  }

  const { createPaperclipClient } = await import("@/lib/paperclip/client");
  const client = createPaperclipClient({ apiUrl, boardKey, companyId });

  const result = await client.heartbeatRunEvents(id);

  if (!result.ok) {
    if (/HTTP 404\b|not[ _-]?found/i.test(result.error)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Paperclip heartbeatRunEvents failed: ${result.error}` },
      { status: 503 },
    );
  }

  return sseStream(result.data.map(mapEvent));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (dataSource() === "paperclip") {
    return getPaperclipRunEvents(id);
  }

  // Hermes had no per-run event stream — return an empty (immediately-closing)
  // SSE stream so the EventSource sees no events and then ends.
  return sseStream([]);
}
