import { NextResponse } from "next/server";

// TODO: wire to real scheduler (crontab / queue).

export const runtime = "nodejs";

export interface ScheduledJob {
  name: string;
  cron: string;
  last_run_label: string;
  next_in: string;
}

export interface ScheduledJobsData {
  jobs: ScheduledJob[];
}

export async function GET(): Promise<Response> {
  const data: ScheduledJobsData = {
    jobs: [
      { name: "vault-ingest", cron: "0 * * * *", last_run_label: "last 15:00 ok", next_in: "in 4m" },
      { name: "cost-report", cron: "0 23 * * *", last_run_label: "last 23:00 ok", next_in: "in 8h 4m" },
      { name: "daily-brief", cron: "0 7 * * *", last_run_label: "last 07:00 ok", next_in: "in 16h 4m" },
    ],
  };
  return NextResponse.json(data);
}
