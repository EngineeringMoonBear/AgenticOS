import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const pagePath = request.nextUrl.searchParams.get("path");
  if (!pagePath) {
    return NextResponse.json(
      { error: "Missing 'path' query parameter" },
      { status: 400 }
    );
  }

  try {
    const store = await getVaultStore();
    const backlinks = await store.getBacklinks(pagePath);
    return NextResponse.json({ backlinks });
  } catch (err) {
    console.error("[GET /api/vault/backlinks]", err);
    return NextResponse.json(
      { error: "Failed to load backlinks" },
      { status: 500 }
    );
  }
}
