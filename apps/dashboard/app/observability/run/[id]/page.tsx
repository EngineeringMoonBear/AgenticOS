import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RunEventLog } from "@/components/observability/RunEventLog";

/**
 * Run detail — a minimal honest view of one agent run: the run id plus the
 * live event stream from /api/agent/runs/[id]/events (real SSE route,
 * Paperclip heartbeat run events). No charts, no derived stats — only what
 * the stream delivers (truth pass 2026-07-14; previously a "Phase 3" stub).
 */

interface RunDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-4 px-6 py-6" style={{ color: "var(--text)" }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Run detail</h1>
          <p
            className="text-sm"
            style={{
              fontFamily: "var(--font-jetbrains-mono, monospace)",
              color: "var(--text-secondary)",
            }}
          >
            {id}
          </p>
        </div>
        <Link
          href="/runs"
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: "var(--accent-plum-400)" }}
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back to Runs
        </Link>
      </div>

      <RunEventLog runId={id} />
    </div>
  );
}
