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

export async function readRateLimits(since?: string): Promise<RateLimitSample[]> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath(), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const cutoff = since ? new Date(since).getTime() : Date.now() - THIRTY_DAYS_MS;
  const out: RateLimitSample[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const sample = JSON.parse(line) as RateLimitSample;
      if (new Date(sample.ts).getTime() >= cutoff) out.push(sample);
    } catch { /* drop malformed */ }
  }
  return out;
}
