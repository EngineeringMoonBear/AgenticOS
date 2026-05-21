"use client";
import { useState } from "react";
import type { ScheduleRecord } from "@/lib/scheduler/types";

export function ScheduleEditDrawer({
  record,
  onClose,
  onSaved,
}: {
  record: ScheduleRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = record === null;
  const [id, setId] = useState(record?.id ?? "");
  const [skillId, setSkillId] = useState(record?.skillId ?? "curator");
  const [schedule, setSchedule] = useState(record?.schedule ?? "0 3 * * *");
  const [enabled, setEnabled] = useState(record?.enabled ?? true);
  const [threshold, setThreshold] = useState(record?.stalenessThresholdMs ?? 300_000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const url = isNew
        ? "/api/cron"
        : `/api/cron/${encodeURIComponent(record!.id)}`;
      const method = isNew ? "POST" : "PUT";
      const body = isNew
        ? { id, skillId, schedule, enabled, stalenessThresholdMs: threshold }
        : { schedule, enabled, stalenessThresholdMs: threshold };
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({ error: "Save failed" }));
        setError(json.error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!record) return;
    if (!confirm(`Delete schedule "${record.id}"?`)) return;
    setSaving(true);
    try {
      await fetch(`/api/cron/${encodeURIComponent(record.id)}`, { method: "DELETE" });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 w-96 p-6 border-l"
      style={{ background: "var(--surface, #1a1714)", borderColor: "var(--border-subtle)" }}
    >
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">{isNew ? "New schedule" : `Edit ${record!.id}`}</h2>
        <button onClick={onClose} className="text-xs" style={{ color: "var(--text-muted)" }}>×</button>
      </header>
      <div className="space-y-3 text-sm">
        {isNew && (
          <Field label="ID">
            <input value={id} onChange={(e) => setId(e.target.value)} className="w-full px-2 py-1 rounded-sm" />
          </Field>
        )}
        {isNew && (
          <Field label="Skill">
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className="w-full px-2 py-1 rounded-sm">
              <option value="curator">curator</option>
            </select>
          </Field>
        )}
        <Field label="Cron expression">
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} className="w-full px-2 py-1 rounded-sm font-mono text-xs" />
        </Field>
        <Field label="Enabled">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </Field>
        <Field label="Staleness threshold (ms)">
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full px-2 py-1 rounded-sm"
          />
        </Field>
        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>
      <footer className="flex items-center justify-between mt-6">
        {!isNew && (
          <button onClick={handleDelete} className="text-xs underline" style={{ color: "var(--error)" }}>
            Delete
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-md ml-auto"
          style={{ background: "var(--accent-plum-400)", color: "var(--text-inverse, white)" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </footer>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}
