"use client";
import { useState } from "react";

export function RunNowButton({ scheduleId, onDispatch }: { scheduleId: string; onDispatch: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/cron/${encodeURIComponent(scheduleId)}/run`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(json.error ?? "Failed");
        return;
      }
      onDispatch();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={handleClick}
        disabled={pending}
        className="text-xs px-3 py-1 rounded-md"
        style={{
          background: pending ? "var(--surface-muted)" : "var(--lane-hermes, #4db6ac)",
          color: "var(--text-inverse, white)",
        }}
      >
        {pending ? "Dispatching…" : "Run now"}
      </button>
      {error && <span className="text-[10px] mt-1" style={{ color: "var(--error, #f87171)" }}>{error}</span>}
    </div>
  );
}
