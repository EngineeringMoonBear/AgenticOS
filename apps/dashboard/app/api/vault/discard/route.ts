import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) return NextResponse.json({ error: "VAULT_SERVER_URL not set" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { inboxPath?: string };
  if (!body.inboxPath) return NextResponse.json({ error: "inboxPath required" }, { status: 400 });
  try {
    const res = await fetch(`${baseUrl}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inboxPath: body.inboxPath }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
