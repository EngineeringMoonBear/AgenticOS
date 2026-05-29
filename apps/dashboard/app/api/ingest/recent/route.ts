import { NextResponse } from "next/server";

// TODO: wire to vault-ingest run history.

export const runtime = "nodejs";

export type IngestStatus = "ok" | "err";

export interface IngestRun {
  id: string;
  time_label: string;
  detail: string;
  status: IngestStatus;
  duration_label: string;
}

export interface IngestRecentData {
  schedule: string;
  runs: IngestRun[];
}

export async function GET(): Promise<Response> {
  const data: IngestRecentData = {
    schedule: "hourly · next 16:00",
    runs: [
      { id: "vault-ingest-5464de072e", time_label: "15:00", detail: "skipped 5", status: "ok", duration_label: "312ms" },
      { id: "vault-ingest-4b4ec8a43d", time_label: "14:08", detail: "errored 2", status: "err", duration_label: "354ms" },
      { id: "vault-ingest-0b3780feba", time_label: "14:00", detail: "updated 1", status: "ok", duration_label: "5.8s" },
    ],
  };
  return NextResponse.json(data);
}
