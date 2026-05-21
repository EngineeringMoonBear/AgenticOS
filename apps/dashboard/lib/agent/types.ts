import { z } from "zod";

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
