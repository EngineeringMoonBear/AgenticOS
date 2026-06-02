import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) return NextResponse.json({ error: "VAULT_SERVER_URL not set" }, { status: 503 });
  const { path } = await ctx.params;
  const inboxPath = path.map(encodeURIComponent).join("/");
  try {
    const res = await fetch(`${baseUrl}/inbox/${inboxPath}`, { cache: "no-store" });
    if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
