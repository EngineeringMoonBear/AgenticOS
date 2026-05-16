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

export async function GET() {
  return NextResponse.json({ tags: TAGS });
}

// POST — stub for Phase 2 "create tag" affordance
export async function POST() {
  return NextResponse.json(
    { error: "Vault writes land in Phase 2" },
    { status: 501 }
  );
}
