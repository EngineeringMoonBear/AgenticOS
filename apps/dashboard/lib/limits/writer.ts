import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RateLimitSample } from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function jsonlPath(): string {
  const home = process.env["AGENTICOS_HOME"] ?? path.join(os.homedir(), ".agenticos");
  return path.join(home, "rate-limits.jsonl");
}

export async function appendRateLimitSample(sample: RateLimitSample): Promise<void> {
  const dir = path.dirname(jsonlPath());
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(sample) + "\n";
  // Append; prune happens lazily on next read or on every 1000th write.
  await fs.appendFile(jsonlPath(), line, { encoding: "utf-8", mode: 0o600 });
}

/** Lazy prune: rewrite the file dropping samples older than 30 days. */
export async function pruneRateLimitsIfNeeded(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath(), "utf-8");
  } catch { return; }
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const lines = raw.split("\n").filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    try {
      const sample = JSON.parse(line) as RateLimitSample;
      if (new Date(sample.ts).getTime() >= cutoff) kept.push(line);
    } catch { /* drop malformed */ }
  }
  if (kept.length === lines.length) return;
  const tmp = jsonlPath() + ".tmp";
  await fs.writeFile(tmp, kept.join("\n") + "\n", { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmp, jsonlPath());
  await fs.chmod(jsonlPath(), 0o600);
}
