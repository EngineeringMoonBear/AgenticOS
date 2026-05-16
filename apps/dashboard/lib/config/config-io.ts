import "server-only";

import fs from "fs/promises";
import os from "os";
import path from "path";
import { AgenticOSConfigSchema, DEFAULT_CONFIG, type AgenticOSConfig } from "./schema";

export { DEFAULT_CONFIG };

function getConfigDir(): string {
  return path.join(os.homedir(), ".agenticos");
}

function getConfigFile(): string {
  return path.join(getConfigDir(), "config.json");
}

function getConfigTmp(): string {
  return path.join(getConfigDir(), "config.json.tmp");
}

export async function readConfig(): Promise<AgenticOSConfig> {
  const CONFIG_FILE = getConfigFile();
  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_FILE, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `AgenticOS config file at ${CONFIG_FILE} contains malformed JSON. ` +
        `Fix or delete the file to reset to defaults.`
    );
  }

  const result = AgenticOSConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `AgenticOS config file at ${CONFIG_FILE} failed schema validation: ${issues}`
    );
  }

  return result.data;
}

export async function writeConfig(cfg: AgenticOSConfig): Promise<void> {
  const CONFIG_DIR = getConfigDir();
  const CONFIG_FILE = getConfigFile();
  const CONFIG_TMP = getConfigTmp();

  // Ensure directory exists
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const json = JSON.stringify(cfg, null, 2);

  // Atomic write: write to tmp then rename
  await fs.writeFile(CONFIG_TMP, json, { encoding: "utf-8", mode: 0o600 });
  await fs.rename(CONFIG_TMP, CONFIG_FILE);

  // chmod 600 on the final file (writeFile mode may not always carry through on rename)
  await fs.chmod(CONFIG_FILE, 0o600);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
