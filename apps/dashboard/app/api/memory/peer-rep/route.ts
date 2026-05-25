import "server-only";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Memory backend is OpenViking (filesystem over /opt/vault); peer-rep endpoint
// pending wire-up. Stub remains so callers get a deterministic 501.
export async function GET() {
  return NextResponse.json(
    { error: "memory backend not implemented (Spec 1 transition)" },
    { status: 501 },
  );
}
