"use client";
import { useState } from "react";
import { useHermesCron } from "@/lib/hooks/use-hermes-cron";
import { RunNowButton } from "@/components/observability/RunNowButton";
import { ScheduleEditDrawer } from "@/components/observability/ScheduleEditDrawer";
import type { ScheduleRecord } from "@agenticos/hermes-client";

export default function SchedulesPage() {
  const { data: schedules, isLoading, refetch } = useHermesCron();
  const [editing, setEditing] = useState<ScheduleRecord | "new" | null>(null);

  return (
    <main className="p-6 max-w-4xl">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-medium">Schedules</h1>
        <button
          onClick={() => setEditing("new")}
          className="text-sm px-3 py-1.5 rounded-md"
          style={{ background: "var(--accent-plum-400)", color: "var(--text-inverse, white)" }}
        >
          + Add Schedule
        </button>
      </header>
      {isLoading && <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>}
      {schedules && schedules.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No schedules yet. Add one to dispatch a skill on a cron.
        </p>
      )}
      <ul className="space-y-2">
        {schedules?.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 p-3 rounded-md"
            style={{ background: "var(--surface, #1a1714)" }}
          >
            <div className="flex-1">
              <div className="text-sm font-medium">{s.id}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {s.skillId} · {s.schedule} · {s.enabled ? "enabled" : "disabled"}
              </div>
              {s.lastRunAt && (
                <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                  last run {new Date(s.lastRunAt).toLocaleString()}
                </div>
              )}
            </div>
            <RunNowButton scheduleId={s.id} onDispatch={() => refetch()} />
            <button
              onClick={() => setEditing(s)}
              className="text-xs px-2 py-1 underline"
              style={{ color: "var(--text-muted)" }}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <ScheduleEditDrawer
          record={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refetch(); }}
        />
      )}
    </main>
  );
}
