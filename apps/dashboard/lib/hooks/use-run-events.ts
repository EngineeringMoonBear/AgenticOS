"use client";
import { useEffect, useState } from "react";

// Local event shape — server-side streaming was Hermes-only.
// Kept as a stub until Claude Code event streaming is wired in a future task.
export interface RunEvent {
  ts: string;
  kind: string;
  payload: unknown;
}

export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<RunEvent[]>([]);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    const es = new EventSource(`/api/agent/runs/${encodeURIComponent(runId)}/events`);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as RunEvent;
        setEvents((prev) => [...prev, evt]);
      } catch { /* drop malformed */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  return events;
}
