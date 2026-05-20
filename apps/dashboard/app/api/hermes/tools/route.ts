import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

export async function GET() {
  try {
    const client = await getHermesClient();
    const tools = await client.listTools();
    return NextResponse.json({ tools });
  } catch (err) {
    console.error("/api/hermes/tools failed:", err);
    return NextResponse.json({ error: "Failed to list tools" }, { status: 503 });
  }
}
