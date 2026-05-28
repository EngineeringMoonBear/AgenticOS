import { NextResponse } from "next/server";

// TODO: wire to real backend (Droplet health endpoints / status pages)

export const runtime = "nodejs";

export interface ResourceMetric {
  name: string;
  percent: number;
  detail: string;
}

export interface SystemResourcesData {
  cpu: ResourceMetric;
  ram: ResourceMetric;
  disk: ResourceMetric;
  meta: string;
}

export async function GET(): Promise<Response> {
  const data: SystemResourcesData = {
    cpu: { name: "CPU", percent: 12, detail: "12% · 2 vCPU" },
    ram: { name: "RAM", percent: 65, detail: "2.6 / 4.0 GB · 65%" },
    disk: { name: "Disk", percent: 28, detail: "22.4 / 80 GB · 28%" },
    meta: "droplet · 4 GB · uptime 3d 14h",
  };
  return NextResponse.json(data);
}
