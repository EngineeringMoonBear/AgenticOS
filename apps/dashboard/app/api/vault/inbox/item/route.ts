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
    // The error message can embed the user-supplied `path` (e.g. remote-client
    // throws `vault-server /inbox/${inboxPath} -> HTTP ...`). Strip line
    // terminators before logging so a crafted `?path=` can't forge log entries
    // (CWE-117 log injection).
    const detail = (err instanceof Error ? err.message : String(err)).replace(
      /[\r\n]+/g,
      " "
    );
    console.error("[GET /api/vault/inbox/item]", detail);
    return NextResponse.json(
      { error: "Failed to load inbox item" },
      { status: 500 }
    );
  }
}
