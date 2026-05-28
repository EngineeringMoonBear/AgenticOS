import { NextResponse } from "next/server";

// TODO: wire to real backend (Droplet health endpoints / status pages)

export const runtime = "nodejs";

export interface ExternalService {
  name: string;
  status: string;
  ok: boolean;
}

export interface ExternalServicesData {
  services: ExternalService[];
  checked_at: string;
}

export async function GET(): Promise<Response> {
  const data: ExternalServicesData = {
    services: [
      { name: "OpenAI API", status: "82ms", ok: true },
      { name: "DigitalOcean", status: "ok", ok: true },
      { name: "GitHub", status: "ok", ok: true },
      { name: "Cloudflare Access", status: "ok", ok: true },
    ],
    checked_at: new Date().toISOString(),
  };
  return NextResponse.json(data);
}
