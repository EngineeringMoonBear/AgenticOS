import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

// Mock 'server-only' so it doesn't throw in the test environment
vi.mock("server-only", () => ({}));

import { readConfig, writeConfig, DEFAULT_CONFIG } from "./config-io";

let tmpDir: string;

beforeEach(async () => {
  // Each test gets a unique temp directory — never touches ~/.agenticos
  tmpDir = path.join(os.tmpdir(), `agenticos-test-${crypto.randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Redirect os.homedir() so config-io uses our temp dir
function mockHomedir(): void {
  vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
}

// Helper to write a raw string into the temp config location
async function writeTmpConfig(content: string): Promise<void> {
  const configDir = path.join(tmpDir, ".agenticos");
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, "config.json"), content, "utf-8");
}

describe("readConfig", () => {
  it("returns defaults when file is missing", async () => {
    mockHomedir();
    const cfg = await readConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.projectRoots).toEqual([]);
    expect(cfg.vaultPath).toBe("~/Documents/Dev Projects/vault");
    expect(cfg.modelDefaults.haiku).toBe("claude-haiku-4-5");
  });

  it("returns parsed object when file is present", async () => {
    mockHomedir();
    const validConfig = {
      projectRoots: [{ path: "/tmp/myproject", tags: ["code"] }],
      vaultPath: "~/vault",
      modelDefaults: {
        haiku: "claude-haiku-4-5",
        sonnet: "claude-sonnet-4-7",
        opus: "claude-opus-4-7",
      },
      connectors: [
        { id: "farmos", enabled: true },
        { id: "odoo", enabled: false },
        { id: "ghost", enabled: false },
        { id: "asana", enabled: false },
        { id: "slack", enabled: false },
        { id: "gh", enabled: false },
      ],
    };
    await writeTmpConfig(JSON.stringify(validConfig));
    const cfg = await readConfig();
    expect(cfg.vaultPath).toBe("~/vault");
    expect(cfg.projectRoots).toHaveLength(1);
    expect(cfg.projectRoots[0].path).toBe("/tmp/myproject");
    expect(cfg.connectors[0].enabled).toBe(true);
  });

  it("throws a clear error on malformed JSON", async () => {
    mockHomedir();
    await writeTmpConfig("{ this is not valid json }}}");
    await expect(readConfig()).rejects.toThrow(/malformed JSON/);
  });

  it("throws on schema mismatch", async () => {
    mockHomedir();
    // vaultPath must be a string, not a number
    await writeTmpConfig(JSON.stringify({ vaultPath: 12345 }));
    await expect(readConfig()).rejects.toThrow(/schema validation/);
  });
});

describe("writeConfig", () => {
  it("creates the directory and file", async () => {
    mockHomedir();
    await writeConfig(DEFAULT_CONFIG);
    const configPath = path.join(tmpDir, ".agenticos", "config.json");
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.vaultPath).toBe(DEFAULT_CONFIG.vaultPath);
  });

  it("round-trips: written config can be read back", async () => {
    mockHomedir();
    const custom = {
      ...DEFAULT_CONFIG,
      vaultPath: "~/custom-vault",
      projectRoots: [{ path: "/tmp/proj", tags: ["test"] }],
    };
    await writeConfig(custom);
    const read = await readConfig();
    expect(read.vaultPath).toBe("~/custom-vault");
    expect(read.projectRoots[0].tags).toEqual(["test"]);
  });

  it("is atomic: tmp file does not persist after successful write", async () => {
    mockHomedir();
    await writeConfig(DEFAULT_CONFIG);

    // The .tmp file should NOT exist after write completes
    const tmpFile = path.join(tmpDir, ".agenticos", "config.json.tmp");
    await expect(fs.access(tmpFile)).rejects.toThrow();

    // The real file DOES exist
    const configFile = path.join(tmpDir, ".agenticos", "config.json");
    await expect(fs.access(configFile)).resolves.toBeUndefined();
  });
});
