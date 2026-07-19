"use client";
import { useEffect, useRef } from "react";
import { useRunEvents } from "@/lib/hooks/use-run-events";

/**
 * Live event log for the run-detail page. Connects an EventSource to
 * /api/agent/runs/[id]/events (real SSE route — Paperclip heartbeat run
 * events, redacted server-side) via {@link useRunEvents} and renders each
 * event as a monospace line, auto-scrolling as new events arrive.
 *
 * Honest by construction: only events the stream actually delivered are
 * shown; an empty stream renders an explicit empty state.
 */

interface RunEventLogProps {
  runId: string;
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(11, 23); // HH:MM:SS.mmm (UTC)
}

function formatPayload(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function RunEventLog({ runId }: RunEventLogProps) {
  const events = useRunEvents(runId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the newest event as lines stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto rounded-md border p-3"
      style={{
        maxHeight: "60vh",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-muted)",
        fontFamily: "var(--font-jetbrains-mono, monospace)",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {events.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          No events received from the stream (yet).
        </p>
      ) : (
        events.map((evt, i) => (
          <div
            key={`${evt.ts}-${i}`}
            className="flex gap-3 whitespace-pre-wrap break-all"
          >
            <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
              {formatTs(evt.ts)}
            </span>
            <span
              className="shrink-0"
              style={{ color: "var(--accent-plum-400)" }}
            >
              {evt.kind}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              {formatPayload(evt.payload)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
