"use client";
import { useEffect, useState } from "react";
import type { HermesEvent } from "@agenticos/hermes-client";

export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<HermesEvent[]>([]);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    const es = new EventSource(`/api/hermes/runs/${encodeURIComponent(runId)}/events`);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as HermesEvent;
        setEvents((prev) => [...prev, evt]);
      } catch { /* drop malformed */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  return events;
}
