import "server-only";
import cron from "node-cron";
import { getHermesClient } from "@/lib/hermes/client-singleton";
import { readSchedules, updateSchedule } from "./cron-io";
import type { HermesRun, ScheduleRecord } from "@agenticos/hermes-client";

const SANITY_CANCEL_THRESHOLD_MS = 30 * 60 * 1000;
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

export async function sanityCancelStaleRuns(skillId: string): Promise<void> {
  const client = await getHermesClient();
  const runs = await client.listRuns({ skillId, status: "running" });
  const cutoff = Date.now() - SANITY_CANCEL_THRESHOLD_MS;
  for (const run of runs) {
    const startedMs = new Date(run.startedAt).getTime();
    if (startedMs < cutoff) {
      await client.cancelRun(run.id, "stale-sanity");
    }
  }
}

async function fireSchedule(id: string): Promise<HermesRun | null> {
  const schedules = await readSchedules();
  const record = schedules.find((s) => s.id === id);
  if (!record || !record.enabled) return null;
  await sanityCancelStaleRuns(record.skillId);
  const client = await getHermesClient();
  // Skill metadata is hardcoded in Phase 3 — see lib/skills/curator.ts (Task 5)
  const { resolveSkill } = await import("@/lib/skills");
  const skill = await resolveSkill(record.skillId);
  const run = await client.dispatchRun({
    skillId:      skill.id,
    model:        skill.model,
    budget:       skill.budget,
    toolNames:    skill.toolNames,
    systemPrompt: skill.systemPrompt,
    userPrompt:   skill.userPrompt({ todayIso: new Date().toISOString().slice(0, 10), lastRunIso: record.lastRunAt ?? "never", budget: skill.budget ?? 1.0 }),
  });
  await updateSchedule(id, { lastRunAt: new Date().toISOString(), lastRunId: run.id });
  return run;
}

export async function triggerSchedule(id: string): Promise<HermesRun> {
  const run = await fireSchedule(id);
  if (!run) throw new Error(`Schedule not found or disabled: ${id}`);
  return run;
}
