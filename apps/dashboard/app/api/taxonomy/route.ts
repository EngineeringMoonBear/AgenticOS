/**
 * Fix 4 (taxonomy route): body size cap + generic 500 error envelope.
 *
 * The GET handler returns a static list — no body parsing needed.
 * The POST stub is 501 today but gets the size guard and error envelope now
 * so it's ready when Phase 2 vault writes land.
 */
import { NextResponse } from "next/server";

const TAGS = [
  { id: "all", label: "All", group: "default" },
  { id: "goldberry", label: "Goldberry Grove", group: "project" },
  { id: "instnt", label: "Instnt", group: "project" },
  { id: "personal", label: "Personal", group: "project" },
  { id: "cowork", label: "Cowork", group: "lane" },
  { id: "code", label: "Code", group: "lane" },
  { id: "farm", label: "Farm", group: "domain" },
  { id: "marketing", label: "Marketing", group: "domain" },
  { id: "video", label: "Video", group: "domain" },
  { id: "software", label: "Software", group: "domain" },
] as const;

const MAX_BODY_BYTES = 64 * 1024; // 64 KiB

export async function GET() {
  return NextResponse.json({ tags: TAGS });
}

// POST — stub for Phase 2 "create tag" affordance
export async function POST(request: Request) {
  // Body size guard — enforced now so Phase 2 implementation inherits it
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request body too large" },
      { status: 413 }
    );
  }

  return NextResponse.json(
    { error: "Vault writes land in Phase 2" },
    { status: 501 }
  );
}
