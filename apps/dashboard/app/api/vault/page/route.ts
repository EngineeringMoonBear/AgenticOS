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
    const page = await store.read(pagePath);
    if (!page) {
      return NextResponse.json(
        { error: "Page not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("[GET /api/vault/page]", err);
    return NextResponse.json(
      { error: "Failed to load page" },
      { status: 500 }
    );
  }
}
