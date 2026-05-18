import { NextResponse } from "next/server";
import { z } from "zod";
import { getVaultStore } from "@/lib/vault/store-singleton";

const RequestSchema = z.object({
  inboxPath: z.string().min(1),
});

export async function POST(req: Request): Promise<NextResponse> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = RequestSchema.safeParse(parsed);
  if (!input.success) {
    return NextResponse.json(
      { error: "Invalid request", details: input.error.issues },
      { status: 400 }
    );
  }

  const { inboxPath } = input.data;

  try {
    const store = await getVaultStore();
    await store.discardInbox(inboxPath);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[POST /api/vault/inbox/discard]", err);
    return NextResponse.json({ error: "Failed to discard inbox note" }, { status: 500 });
  }
}
