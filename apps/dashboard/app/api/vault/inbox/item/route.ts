import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const itemPath = request.nextUrl.searchParams.get("path");
  if (!itemPath) {
    return NextResponse.json(
      { error: "Missing 'path' query parameter" },
      { status: 400 }
    );
  }

  try {
    const store = await getVaultStore();
    const note = await store.readInbox(itemPath);
    if (!note) {
      return NextResponse.json(
        { error: "Inbox item not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(note);
  } catch (err) {
    console.error("[GET /api/vault/inbox/item]", err);
    return NextResponse.json(
      { error: "Failed to load inbox item" },
      { status: 500 }
    );
  }
}
