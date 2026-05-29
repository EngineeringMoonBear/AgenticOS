import { NextResponse } from "next/server";
import { vikingRetrieval } from "@/lib/api/viking";

export const runtime = "nodejs";

interface GraphNode {
  id: string;
  kind: "uri" | "session";
  label: string;
  size: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
  at: string;
}

interface RetrievalEvent {
  uri?: string;
  session_id?: string;
  at?: string;
  relevant?: unknown[];
}

function lastSegment(uri: string): string {
  const trimmed = uri.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "uri required" }, { status: 400 });
  }

  const sinceRaw = url.searchParams.get("since");
  const sinceMs = sinceRaw
    ? Date.parse(sinceRaw)
    : Date.now() - 30 * 24 * 60 * 60 * 1000;

  try {
    const retrieval = await vikingRetrieval();
    const events = ((retrieval.events ?? []) as RetrievalEvent[]).filter((ev) => {
      if (ev.uri !== uri) return false;
      if (!ev.at) return false;
      const t = Date.parse(ev.at);
      return Number.isFinite(t) && t >= sinceMs;
    });

    let uriSize = 0;
    const sessions = new Map<string, number>();
    const links: GraphLink[] = [];

    for (const ev of events) {
      const relevantLen = Array.isArray(ev.relevant) ? ev.relevant.length : 0;
      uriSize += relevantLen;
      const sid = ev.session_id ?? "unknown";
      sessions.set(sid, (sessions.get(sid) ?? 0) + 1);
      links.push({ source: sid, target: uri, weight: 1, at: ev.at ?? "" });
    }

    const nodes: GraphNode[] = [
      { id: uri, kind: "uri", label: lastSegment(uri), size: uriSize },
      ...Array.from(sessions.entries()).map(([sid, count]) => ({
        id: sid,
        kind: "session" as const,
        label: sid.slice(0, 8),
        size: count,
      })),
    ];

    return NextResponse.json({ nodes, links });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, available: false }, { status: 503 });
  }
}
