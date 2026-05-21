import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseStreamJson, type ParsedRun } from "./spawn";

describe("parseStreamJson", () => {
  it("accumulates input/output tokens across assistant events", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s1", model: "claude-sonnet-4-7" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [],
          usage: { input_tokens: 30, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.003, duration_ms: 5000, is_error: false }),
    ];
    const result: ParsedRun = parseStreamJson(lines);
    expect(result.inputTokens).toBe(130);
    expect(result.outputTokens).toBe(70);
    expect(result.costUsd).toBe(0.003);
    expect(result.isError).toBe(false);
    expect(result.sessionId).toBe("s1");
  });

  it("flags errors when result.is_error is true", () => {
    const lines = [
      JSON.stringify({ type: "system", session_id: "s2" }),
      JSON.stringify({ type: "result", subtype: "error", is_error: true }),
    ];
    const result = parseStreamJson(lines);
    expect(result.isError).toBe(true);
  });

  it("ignores malformed JSON lines without crashing", () => {
    const lines = [
      "{not valid json}",
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.001 }),
    ];
    const result = parseStreamJson(lines);
    expect(result.costUsd).toBe(0.001);
  });
});
