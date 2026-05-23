import "server-only";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Honcho memory backend was removed in Spec 1; OpenViking takes over in Task 18.
export async function GET() {
  return NextResponse.json(
    { sessions: [], error: "memory backend not implemented (Spec 1 transition)" },
    { status: 501 },
  );
}
