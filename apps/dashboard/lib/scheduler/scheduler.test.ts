import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "scheduler-"));
  process.env["AGENTICOS_HOME"] = path.join(tmpRoot, ".agenticos");
});

afterEach(async () => {
  delete process.env["AGENTICOS_HOME"];
  await rm(tmpRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe("sanityCancelStaleRuns", () => {
  it("is a no-op in the v2 scaffold (dispatch logic moves to run-curator.sh)", async () => {
    const { sanityCancelStaleRuns } = await import("./scheduler");
    await expect(sanityCancelStaleRuns("curator")).resolves.toBeUndefined();
  });
});
