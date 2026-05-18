import { NextResponse } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET(): Promise<NextResponse> {
  try {
    const store = await getVaultStore();
    const items = await store.listInbox();
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[GET /api/vault/inbox]", err);
    return NextResponse.json(
      { error: "Failed to load inbox" },
      { status: 500 }
    );
  }
}
