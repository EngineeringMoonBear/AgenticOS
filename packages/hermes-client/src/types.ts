// ── Core run types ──────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type RunId     = string;
export type SkillId   = string;
export type CronId    = string;

export interface HermesRun {
  id:           RunId;
  skillId:      SkillId;
  status:       RunStatus;
  model:        string;
  startedAt:    string;
  completedAt?: string;
  durationMs?:  number;
  costUsd?:     number;
  inputTokens:  number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cancelReason?: string;
  tags:         string[];
}

export interface HermesEvent {
  runId:     RunId;
  seq:       number;
  ts:        string;
  kind:      "log" | "tool_call" | "tool_result" | "usage_delta" | "status_change";
  payload:   unknown;
}

export interface HermesCron {
  id:         CronId;
  skillId:    SkillId;
  schedule:   string;
  enabled:    boolean;
  lastRunAt?: string;
  lastRunId?: RunId;
  nextRunAt:  string;
}

export interface HermesHealth {
  status:     "ok" | "degraded" | "offline";
  version:    string;
  uptimeMs:   number;
  activeRuns: number;
}

export interface HermesTool {
  name:        string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ── Derived types for UI ────────────────────────────────────────────

export interface RunVitalSigns {
  runId:           RunId;
  state:           RunStatus;
  lastEventAt:     number;
  toolCallCount:   number;
  costUsd:         number;
  inputTokens:     number;
  outputTokens:    number;
  isStale:         boolean;
  throttledUntil?: string;
}

// ── Scheduler (cron.json on disk) ───────────────────────────────────

export interface ScheduleRecord {
  id:                    CronId;
  skillId:               SkillId;
  schedule:              string;
  enabled:               boolean;
  lastRunAt?:            string;
  lastRunId?:            RunId;
  nextRunAt?:            string;
  stalenessThresholdMs:  number;
}
