import { z } from "zod";

// ---------------------------------------------------------------------------
// Hermes API task types (Spec 1)
// ---------------------------------------------------------------------------

export type TaskStatus = "queued" | "running" | "done" | "failed" | "budget-blocked";

export interface Task {
  id: string;
  kind: string;
  trigger: string;
  status: TaskStatus;
  started_at: string;
  ended_at: string | null;
  cost_cents: number;
  error: string | null;
  metadata: Record<string, unknown>;
}

export interface Session {
  id: string;
  task_id: string;
  hermes_skill: string;
  started_at: string;
  ended_at: string | null;
  cost_cents: number;
}

export interface Call {
  id: number;
  session_id: string;
  task_id: string;
  provider: "openai" | "ollama";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  latency_ms: number;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateTaskInput {
  kind: string;
  prompt: string;
  trigger?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskWithDrillDown extends Task {
  sessions: Array<Session & { calls: Call[] }>;
}

// ---------------------------------------------------------------------------
// Legacy Claude Code stream-json / run record types (used by spawn.ts)
// ---------------------------------------------------------------------------

export const RunStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "budget_exceeded",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunRecord = z.object({
  id: z.string(),
  agent: z.string(),
  status: RunStatus,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreationTokens: z.number(),
  toolCalls: z.number(),
  errorMessage: z.string().nullable(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export const StreamJsonEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("system"),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal("assistant"),
    message: z.object({
      content: z.array(z.unknown()),
      usage: z.object({
        input_tokens: z.number(),
        output_tokens: z.number(),
        cache_read_input_tokens: z.number().optional(),
        cache_creation_input_tokens: z.number().optional(),
      }).optional(),
    }),
  }),
  z.object({
    type: z.literal("user"),
    message: z.object({ content: z.array(z.unknown()) }),
  }),
  z.object({
    type: z.literal("result"),
    subtype: z.string(),
    total_cost_usd: z.number().optional(),
    duration_ms: z.number().optional(),
    is_error: z.boolean().optional(),
  }),
]);
export type StreamJsonEvent = z.infer<typeof StreamJsonEvent>;
