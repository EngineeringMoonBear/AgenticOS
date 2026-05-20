import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Mock 'server-only' so it doesn't throw in the test environment
vi.mock("server-only", () => ({}));

import { readConfig, writeConfig, DEFAULT_CONFIG } from "./config-io";
import { AgenticOSConfigSchema } from "./schema";

let tmpDir: string;

beforeEach(async () => {
  // Each test gets a unique temp directory — never touches ~/.agenticos.
  // mkdtemp is atomic + OS-randomized suffix + 0700 perms (Unix default);
  // resolves CodeQL js/insecure-temporary-file by removing the
  // `os.tmpdir() + manually-named + mkdir` pattern the analyzer can't prove
  // safe from local-attacker pre-creation races.
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agenticos-test-"));
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

/**
 * Fix 2 path validator tests — these exercise the absolutePath Zod refinement
 * applied to vaultPath and ProjectRootSchema.path.
 */
describe("path validators (Fix 2)", () => {
  const baseConfig = {
    projectRoots: [],
    modelDefaults: {
      haiku: "claude-haiku-4-5",
      sonnet: "claude-sonnet-4-7",
      opus: "claude-opus-4-7",
    },
    connectors: [],
  };

  it("accepts an absolute POSIX path (starting with /)", () => {
    const result = AgenticOSConfigSchema.safeParse({
      ...baseConfig,
      vaultPath: "/home/user/vault",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a tilde-prefixed home path (starting with ~)", () => {
    const result = AgenticOSConfigSchema.safeParse({
      ...baseConfig,
      vaultPath: "~/Documents/Dev Projects/vault",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a relative path (no leading / or ~)", () => {
    const result = AgenticOSConfigSchema.safeParse({
      ...baseConfig,
      vaultPath: "relative/path/vault",
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.includes("absolute")
      )
    ).toBe(true);
  });

  it("rejects a path containing .. segments", () => {
    const result = AgenticOSConfigSchema.safeParse({
      ...baseConfig,
      vaultPath: "/home/user/../etc/passwd",
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.includes("..")
      )
    ).toBe(true);
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
