import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(path.join(tmpdir(), "limits-"));
  process.env["AGENTICOS_HOME"] = homeDir;
});

afterEach(async () => {
  delete process.env["AGENTICOS_HOME"];
  await rm(homeDir, { recursive: true, force: true });
  vi.resetModules();
});

describe("appendRateLimitSample", () => {
  it("creates the file with one line per sample (JSONL)", async () => {
    const { appendRateLimitSample } = await import("../writer");
    await appendRateLimitSample({
      ts: "2026-05-19T00:00:00Z", runId: "r1",
      limitRequests: 5000, remainingRequests: 4500, resetRequestsAt: "2026-05-19T01:00:00Z",
      limitTokens: 100_000, remainingTokens: 80_000, resetTokensAt: "2026-05-19T01:00:00Z",
    });
    const raw = await readFile(path.join(homeDir, "rate-limits.jsonl"), "utf-8");
    expect(raw.split("\n").filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(raw.split("\n")[0]!).runId).toBe("r1");
  });
});

describe("readRateLimits", () => {
  it("returns empty when file missing", async () => {
    const { readRateLimits } = await import("../reader");
    expect(await readRateLimits()).toEqual([]);
  });

  it("filters out samples older than 30 days", async () => {
    const { appendRateLimitSample } = await import("../writer");
    const { readRateLimits } = await import("../reader");
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    await appendRateLimitSample({
      ts: old, runId: "old", limitRequests: 1, remainingRequests: 1,
      resetRequestsAt: old, limitTokens: 1, remainingTokens: 1, resetTokensAt: old,
    });
    await appendRateLimitSample({
      ts: recent, runId: "new", limitRequests: 1, remainingRequests: 1,
      resetRequestsAt: recent, limitTokens: 1, remainingTokens: 1, resetTokensAt: recent,
    });
    const all = await readRateLimits();
    expect(all.map((s) => s.runId)).toEqual(["new"]);
  });
});

describe("willNextRunFit", () => {
  it("returns fits=true when remaining headroom is comfortable", async () => {
    const { willNextRunFit } = await import("../projection");
    const result = willNextRunFit({
      requests: { limit: 5000, remaining: 4500, resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      tokens:   { limit: 100_000, remaining: 90_000, resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    expect(result.fits).toBe(true);
  });

  it("returns fits=false when tokens remaining < 5%", async () => {
    const { willNextRunFit } = await import("../projection");
    const result = willNextRunFit({
      requests: { limit: 5000, remaining: 4500, resetAt: "2099-01-01" },
      tokens:   { limit: 100_000, remaining: 2000, resetAt: "2099-01-01" },
    });
    expect(result.fits).toBe(false);
    expect(result.reason).toContain("tokens");
  });
});
