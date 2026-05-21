import "server-only";
import cron from "node-cron";
import { readSchedules, updateSchedule } from "./cron-io";
import type { RunRecord } from "@/lib/agent";
import type { ScheduleRecord } from "./types";

const registered = new Map<string, cron.ScheduledTask>();

export async function bootScheduler(): Promise<void> {
  const schedules = await readSchedules();
  for (const s of schedules) if (s.enabled) registerSchedule(s);
}

export function registerSchedule(record: ScheduleRecord): void {
  if (registered.has(record.id)) {
    registered.get(record.id)!.stop();
    registered.delete(record.id);
  }
  const task = cron.schedule(record.schedule, () => {
    void fireSchedule(record.id).catch((err) => {
      console.error(`Scheduler fire ${record.id} failed:`, err);
    });
  });
  registered.set(record.id, task);
}

export function unregisterSchedule(id: string): void {
  registered.get(id)?.stop();
  registered.delete(id);
}

/**
 * Sanity-cancel stale runs.
 *
 * Foundation v1 (Hermes) tracked active runs server-side and could cancel them.
 * Foundation v2 hands runs off to a shell script (Task 41) that writes a JSONL
 * log. There's no daemon-side "cancel" yet — this is a no-op pending the
 * Phase 5 dispatch wiring.
 */
export async function sanityCancelStaleRuns(_skillId: string): Promise<void> {
  // No-op for v2. Re-implementation lives with the dispatch script (Task 41).
}

async function fireSchedule(id: string): Promise<RunRecord | null> {
  const schedules = await readSchedules();
  const record = schedules.find((s) => s.id === id);
  if (!record || !record.enabled) return null;
  await sanityCancelStaleRuns(record.skillId);

  // Phase 5 will wire the actual dispatch (shell out to /opt/agenticos/scripts/run-curator.sh)
  // For now this is a scaffold so the scheduler boots cleanly.
  await updateSchedule(id, { lastRunAt: new Date().toISOString() });
  return null;
}

export async function triggerSchedule(id: string): Promise<RunRecord> {
  const run = await fireSchedule(id);
  if (!run) throw new Error(`Schedule not found, disabled, or dispatch not yet wired: ${id}`);
  return run;
}
