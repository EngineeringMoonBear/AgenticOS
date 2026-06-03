import Link from "next/link";
import { Activity, ArrowLeft } from "lucide-react";

interface RunDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;

  return (
    <div
      className="flex flex-col items-center justify-center flex-1 gap-4 px-6 py-12"
      style={{ color: "var(--text)" }}
    >
      <Activity
        size={40}
        strokeWidth={1.5}
        style={{ color: "var(--text-muted)" }}
      />
      <div className="text-center">
        <h1 className="text-lg font-medium mb-1">Run detail view</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Run <span style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", color: "var(--text-secondary)" }}>{id}</span> — logs, timeline, and usage wire up in Phase 3.
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
  );
}
