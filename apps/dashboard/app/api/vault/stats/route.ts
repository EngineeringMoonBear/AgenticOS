import { NextResponse } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const store = await getVaultStore();
    const vaultStats = await store.stats();
    return NextResponse.json(vaultStats);
  } catch (err) {
    console.error("[GET /api/vault/stats]", err);
    return NextResponse.json(
      { error: "Failed to load vault stats" },
      { status: 500 }
    );
  }
}
