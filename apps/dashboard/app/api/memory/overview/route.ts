import { NextResponse } from "next/server";
import { vikingOverview } from "@/lib/api/viking";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "uri required" }, { status: 400 });
  }
  try {
    const result = await vikingOverview(uri);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
