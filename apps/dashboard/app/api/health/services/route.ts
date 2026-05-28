import { NextResponse } from "next/server";

// TODO: wire to real backend (Droplet health endpoints / status pages)

export const runtime = "nodejs";

export interface ServiceHealth {
  name: string;
  latency_ms: number;
  ok: boolean;
}

export interface AgentHealthData {
  services: ServiceHealth[];
  checked_at: string;
}

export async function GET(): Promise<Response> {
  const data: AgentHealthData = {
    services: [
      { name: "Hermes Gateway", latency_ms: 2, ok: true },
      { name: "OpenViking", latency_ms: 4, ok: true },
      { name: "Ollama", latency_ms: 12, ok: true },
      { name: "Postgres", latency_ms: 1, ok: true },
    ],
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(data);
}
