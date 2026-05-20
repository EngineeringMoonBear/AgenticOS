import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let cancelRunCalls: Array<{ id: string; reason?: string }> = [];
let tmpRoot: string;

beforeEach(async () => {
  cancelRunCalls = [];
  tmpRoot = await mkdtemp(path.join(tmpdir(), "scheduler-"));
  process.env["AGENTICOS_HOME"] = path.join(tmpRoot, ".agenticos");
});

afterEach(async () => {
  delete process.env["AGENTICOS_HOME"];
  await rm(tmpRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe("sanityCancelStaleRuns", () => {
  it("does nothing when no runs are active", async () => {
    vi.doMock("@/lib/hermes/client-singleton", () => ({
      getHermesClient: async () => ({
        listRuns: vi.fn(async () => []),
        cancelRun: vi.fn(async (id: string, reason?: string) => {
          cancelRunCalls.push({ id, reason });
        }),
        dispatchRun: vi.fn(async () => ({
          id: "run_new", skillId: "curator", status: "queued", model: "x",
          startedAt: "2026", inputTokens: 0, outputTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, tags: [],
        })),
      }),
    }));
    const { sanityCancelStaleRuns } = await import("./scheduler");
    await sanityCancelStaleRuns("curator");
    expect(cancelRunCalls).toHaveLength(0);
  });

  it("cancels runs silent > 30 minutes", async () => {
    const oldTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    vi.doMock("@/lib/hermes/client-singleton", () => ({
      getHermesClient: async () => ({
        listRuns: vi.fn(async () => [
          { id: "run_stale", skillId: "curator", status: "running",
            startedAt: oldTs, model: "x", inputTokens: 0, outputTokens: 0,
            cacheReadTokens: 0, cacheWriteTokens: 0, tags: [] },
        ]),
        cancelRun: vi.fn(async (id: string, reason?: string) => {
          cancelRunCalls.push({ id, reason });
        }),
      }),
    }));
    const { sanityCancelStaleRuns } = await import("./scheduler");
    await sanityCancelStaleRuns("curator");
    expect(cancelRunCalls).toEqual([{ id: "run_stale", reason: "stale-sanity" }]);
  });
});
