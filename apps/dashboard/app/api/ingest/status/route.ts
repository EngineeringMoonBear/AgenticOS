import { NextResponse } from "next/server";
import { getPool } from "@/lib/cost/db";

export const runtime = "nodejs";

interface VaultIngestRow {
  id: string;
  started_at: string;
  status: string;
  metadata: Record<string, unknown> | null;
}

export async function GET(): Promise<Response> {
  const pool = getPool();
  const { rows } = await pool.query<VaultIngestRow>(
    "SELECT id, started_at, status, metadata FROM tasks WHERE kind = 'vault-ingest' ORDER BY started_at DESC LIMIT 1",
  );
  return NextResponse.json(rows[0] ?? null);
}
