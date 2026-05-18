import { NextResponse } from "next/server";
import { getVaultStore } from "@/lib/vault/store-singleton";

export async function POST(): Promise<NextResponse> {
  try {
    const store = await getVaultStore();
    await store.revalidate();
    const { builtAt, pageCount } = store.stats();
    return NextResponse.json({ builtAt, pageCount });
  } catch (err) {
    console.error("[POST /api/vault/revalidate]", err);
    return NextResponse.json(
      { error: "Failed to revalidate vault" },
      { status: 500 }
    );
  }
}
