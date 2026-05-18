import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q") ?? "";
  const tagsParam = searchParams.get("tags");
  const limitParam = searchParams.get("limit");

  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const limit = limitParam ? parseInt(limitParam, 10) : undefined;

  try {
    const store = await getVaultStore();
    const results = await store.search(q, { tags, limit });
    return NextResponse.json({ results, total: results.length });
  } catch (err) {
    console.error("[GET /api/vault/search]", err);
    return NextResponse.json(
      { error: "Failed to search vault" },
      { status: 500 }
    );
  }
}
