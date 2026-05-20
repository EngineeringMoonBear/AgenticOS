import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CronFile, ScheduleRecord } from "./types";

function configDir(): string {
  return process.env["AGENTICOS_HOME"] ?? path.join(os.homedir(), ".agenticos");
}
function configFile(): string { return path.join(configDir(), "cron.json"); }

async function readCronFile(): Promise<CronFile> {
  try {
    const raw = await fs.readFile(configFile(), "utf-8");
    const parsed = JSON.parse(raw) as CronFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.schedules)) {
      return { version: 1, schedules: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, schedules: [] };
    }
    throw err;
  }
}

async function writeCronFile(data: CronFile): Promise<void> {
  await fs.mkdir(configDir(), { recursive: true });
  const tmp = configFile() + ".tmp";
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmp, configFile());
  await fs.chmod(configFile(), 0o600);
}

export async function readSchedules(): Promise<ScheduleRecord[]> {
  return (await readCronFile()).schedules;
}

export async function writeSchedule(record: ScheduleRecord): Promise<ScheduleRecord> {
  const data = await readCronFile();
  const idx = data.schedules.findIndex((s) => s.id === record.id);
  if (idx >= 0) data.schedules[idx] = { ...data.schedules[idx], ...record };
  else data.schedules.push(record);
  await writeCronFile(data);
  return record;
}

export async function updateSchedule(
  id: string,
  patch: Partial<ScheduleRecord>,
): Promise<ScheduleRecord | null> {
  const data = await readCronFile();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  data.schedules[idx] = { ...data.schedules[idx], ...patch };
  await writeCronFile(data);
  return data.schedules[idx] as ScheduleRecord;
}

export async function deleteSchedule(id: string): Promise<void> {
  const data = await readCronFile();
  const next = data.schedules.filter((s) => s.id !== id);
  if (next.length === data.schedules.length) return;
  await writeCronFile({ ...data, schedules: next });
}
