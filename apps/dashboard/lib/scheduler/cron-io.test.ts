import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let tmpRoot: string;
let agentDir: string; // the .agenticos equiv — pointed to by AGENTICOS_HOME

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), "cron-io-"));
  agentDir = path.join(tmpRoot, ".agenticos");
  // cron-io.ts reads AGENTICOS_HOME as the full config dir (replaces ~/.agenticos)
  process.env["AGENTICOS_HOME"] = agentDir;
});

afterEach(async () => {
  delete process.env["AGENTICOS_HOME"];
  await rm(tmpRoot, { recursive: true, force: true });
});

describe("readSchedules", () => {
  it("returns empty array when file missing", async () => {
    const { readSchedules } = await import("./cron-io");
    expect(await readSchedules()).toEqual([]);
  });

  it("returns parsed schedules when file exists", async () => {
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, "cron.json"),
      JSON.stringify({ version: 1, schedules: [
        { id: "c1", skillId: "curator", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 },
      ]}),
    );
    const { readSchedules } = await import("./cron-io");
    const s = await readSchedules();
    expect(s).toHaveLength(1);
    expect(s[0]!.id).toBe("c1");
  });
});

describe("writeSchedule", () => {
  it("creates the directory and writes the file atomically with 0600 perms", async () => {
    const { writeSchedule } = await import("./cron-io");
    await writeSchedule({
      id: "c1", skillId: "curator", schedule: "0 3 * * *",
      enabled: true, stalenessThresholdMs: 300_000,
    });
    const filePath = path.join(agentDir, "cron.json");
    const s = await stat(filePath);
    // chmod 0600 — owner read/write only
    expect((s.mode & 0o777)).toBe(0o600);
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.schedules).toHaveLength(1);
  });

  it("updates existing schedule by id", async () => {
    const { writeSchedule } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "curator", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 });
    await writeSchedule({ id: "c1", skillId: "curator", schedule: "0 4 * * *", enabled: false, stalenessThresholdMs: 300_000 });
    const { readSchedules } = await import("./cron-io");
    const s = await readSchedules();
    expect(s).toHaveLength(1);
    expect(s[0]!.schedule).toBe("0 4 * * *");
    expect(s[0]!.enabled).toBe(false);
  });
});

describe("deleteSchedule", () => {
  it("removes the schedule by id", async () => {
    const { writeSchedule, deleteSchedule, readSchedules } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "x", schedule: "* * * * *", enabled: true, stalenessThresholdMs: 30_000 });
    await deleteSchedule("c1");
    expect(await readSchedules()).toEqual([]);
  });
});

describe("updateSchedule", () => {
  it("patches an existing record", async () => {
    const { writeSchedule, updateSchedule } = await import("./cron-io");
    await writeSchedule({ id: "c1", skillId: "x", schedule: "0 3 * * *", enabled: true, stalenessThresholdMs: 300_000 });
    const updated = await updateSchedule("c1", { enabled: false });
    expect(updated?.enabled).toBe(false);
    expect(updated?.schedule).toBe("0 3 * * *");
  });

  it("returns null for non-existent id", async () => {
    const { updateSchedule } = await import("./cron-io");
    expect(await updateSchedule("missing", { enabled: false })).toBeNull();
  });
});
