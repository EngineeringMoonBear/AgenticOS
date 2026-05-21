/**
 * Scheduler types — local definitions (formerly re-exported from @agenticos/hermes-client).
 * After Foundation v2, schedules are simple cron entries that dispatch agent runs
 * via a shell script. The richer run record lives in @/lib/agent (RunRecord).
 */

export interface ScheduleRecord {
  id: string;
  skillId: string;
  schedule: string;
  enabled: boolean;
  stalenessThresholdMs: number;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  nextRunAt?: string | null;
}

export interface CronFile {
  version: 1;
  schedules: ScheduleRecord[];
}
