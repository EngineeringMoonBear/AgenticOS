import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Droplet CPU/RAM/disk for the System-resources panel.
 *
 * The real source is OpenObserve's `system_*` metric streams on the droplet
 * (system_cpu_usage / system_memory_usage / system_disk_usage collected by
 * the OTel host-metrics receiver), but the dashboard has no OpenObserve
 * credentials yet — so this route honestly reports "not available" instead
 * of the hardcoded "CPU 12%" it used to fabricate (truth pass 2026-07-14).
 *
 * TODO(GOL-313): wire to OpenObserve `system_*` streams once OO credentials
 * are provisioned for the dashboard, then restore per-metric percent values.
 */

export interface SystemResourcesData {
  available: false;
  reason: string;
}

export async function GET(): Promise<Response> {
  const data: SystemResourcesData = {
    available: false,
    reason: "metrics source not connected",
  };
  return NextResponse.json(data);
}
