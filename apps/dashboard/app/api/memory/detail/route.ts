import { NextResponse } from "next/server";
import { vikingDetail } from "@/lib/api/viking";

export const runtime = "nodejs";

const MAX_LIMIT = 65536;

function parseIntStrict(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "uri required" }, { status: 400 });
  }

  const offsetRaw = url.searchParams.get("offset");
  const limitRaw = url.searchParams.get("limit");

  let offset = 0;
  if (offsetRaw !== null) {
    const parsed = parseIntStrict(offsetRaw);
    if (parsed === null || parsed < 0) {
      return NextResponse.json({ error: "offset must be a non-negative integer" }, { status: 400 });
    }
    offset = parsed;
  }

  let limit = 8192;
  if (limitRaw !== null) {
    const parsed = parseIntStrict(limitRaw);
    if (parsed === null || parsed <= 0 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `limit must be in (0, ${MAX_LIMIT}]` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  try {
    const result = await vikingDetail(uri, offset, limit);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
