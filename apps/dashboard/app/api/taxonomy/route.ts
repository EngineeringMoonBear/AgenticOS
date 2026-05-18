import { NextResponse } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function GET() {
  try {
    const store = await getVaultStore();
    const vaultTags = await store.getAllTags();

    const allEntry = { id: "all", label: "All", group: "default", count: 0 };
    const tags = [allEntry, ...vaultTags];

    return NextResponse.json({ tags });
  } catch (err) {
    console.error("[/api/taxonomy] Failed to read taxonomy from vault:", err);
    return NextResponse.json(
      { error: "Failed to read taxonomy" },
      { status: 500 }
    );
  }
}

// POST — stub for Phase 5+ vault writes
export async function POST() {
  return NextResponse.json(
    { error: "Vault writes land in Phase 5+" },
    { status: 501 }
  );
}
