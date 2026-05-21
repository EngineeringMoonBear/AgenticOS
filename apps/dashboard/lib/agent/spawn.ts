import "server-only";
import { spawn } from "node:child_process";
import { StreamJsonEvent } from "./types";

export interface ParsedRun {
  sessionId: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  isError: boolean;
  toolCalls: number;
}

export function parseStreamJson(lines: string[]): ParsedRun {
  const result: ParsedRun = {
    sessionId: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    durationMs: 0,
    isError: false,
    toolCalls: 0,
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const validation = StreamJsonEvent.safeParse(parsed);
    if (!validation.success) continue;
    const event = validation.data;

    switch (event.type) {
      case "system":
        result.sessionId = event.session_id ?? result.sessionId;
        result.model = event.model ?? result.model;
        break;
      case "assistant":
        if (event.message.usage) {
          result.inputTokens += event.message.usage.input_tokens;
          result.outputTokens += event.message.usage.output_tokens;
          result.cacheReadTokens += event.message.usage.cache_read_input_tokens ?? 0;
          result.cacheCreationTokens += event.message.usage.cache_creation_input_tokens ?? 0;
        }
        if (Array.isArray(event.message.content)) {
          for (const block of event.message.content as Array<{ type?: string }>) {
            if (block.type === "tool_use") result.toolCalls += 1;
          }
        }
        break;
      case "result":
        result.costUsd = event.total_cost_usd ?? 0;
        result.durationMs = event.duration_ms ?? 0;
        result.isError = event.is_error ?? false;
        break;
    }
  }

  return result;
}

export interface SpawnClaudeOptions {
  prompt: string;
  mcpConfigPath?: string;
  systemPromptPath?: string;
  cwd?: string;
  timeoutMs?: number;
}

export async function spawnClaude(options: SpawnClaudeOptions): Promise<{
  parsed: ParsedRun;
  stderr: string;
  exitCode: number;
}> {
  const args = [
    "--print",
    options.prompt,
    "--output-format=stream-json",
    "--verbose",
  ];
  if (options.mcpConfigPath) args.push("--mcp-config", options.mcpConfigPath);
  if (options.systemPromptPath) args.push("--append-system-prompt-from", options.systemPromptPath);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: options.cwd,
      env: process.env,
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString("utf-8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      stdoutLines.push(...lines);
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf-8");
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Claude Code timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutBuffer.trim()) stdoutLines.push(stdoutBuffer);
      const parsed = parseStreamJson(stdoutLines);
      resolve({ parsed, stderr, exitCode: code ?? 0 });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
