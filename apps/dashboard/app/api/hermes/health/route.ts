import { NextResponse } from "next/server";
import { getHermesClient } from "@/lib/hermes/client-singleton";

let cached: { health: unknown; sampledAt: number } | null = null;
const TTL_MS = 5000;

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.sampledAt < TTL_MS) {
    return NextResponse.json(cached.health);
  }
  try {
    const client = await getHermesClient();
    const health = await client.getHealth();
    cached = { health, sampledAt: now };
    return NextResponse.json(health);
  } catch {
    const offline = { status: "offline", version: "unknown", uptimeMs: 0, activeRuns: 0 };
    cached = { health: offline, sampledAt: now };
    return NextResponse.json(offline);
  }
}
