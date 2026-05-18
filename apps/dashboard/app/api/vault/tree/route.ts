import { NextResponse } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const store = await getVaultStore();
    const { tree, flat } = await store.list();
    return NextResponse.json({ tree, flatPaths: flat });
  } catch (err) {
    console.error("[GET /api/vault/tree]", err);
    return NextResponse.json(
      { error: "Failed to load vault tree" },
      { status: 500 }
    );
  }
}
