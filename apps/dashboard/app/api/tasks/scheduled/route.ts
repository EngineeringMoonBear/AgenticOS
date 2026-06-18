import { NextResponse } from "next/server";
import { dataSource } from "@/lib/config/data-source";
import { createPaperclipClient } from "@/lib/paperclip/client";
import type { RoutineTrigger } from "@/lib/paperclip/client";

// TODO: wire to real scheduler (crontab / queue).

export const runtime = "nodejs";

export interface ScheduledJob {
  name: string;
  cron: string;
  last_run_label: string;
  next_in: string;
}

export interface ScheduledJobsData {
  jobs: ScheduledJob[];
}

// ── Static plugin-job cron declarations ─────────────────────────────────────
// Source: packages/openviking-plugin/src/manifest.ts (jobKey: "vault-ingest", schedule: "0 * * * *")
// Source: packages/github-plugin/src/manifest.ts (jobKey: "pr-triage", schedule: "30 7 * * *")
//
// Per A.5/SHAPES.md (d): scheduler-heartbeats exposes NO plugin-job last/next-run data.
// Runtime fields are "—" — no fabrication.

const STATIC_PLUGIN_JOBS: ScheduledJob[] = [
  {
    name: "vault-ingest",
    cron: "0 * * * *",
    last_run_label: "—",
    next_in: "—",
  },
  {
    name: "pr-triage",
    cron: "30 7 * * *",
    last_run_label: "—",
    next_in: "—",
  },
];

// ── Relative time helpers ────────────────────────────────────────────────────

/**
 * Formats an ISO timestamp as a relative "next run" label.
 * Examples: "in 4m", "in 2h 14m", "in 3d"
 */
function formatNextIn(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "—";
  const totalMin = Math.round(diffMs / 60_000);
  if (totalMin < 60) return `in ${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours < 24) return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `in ${days}d ${remHours}h` : `in ${days}d`;
}

/**
 * Formats an ISO timestamp as a "last ran at HH:MM" label.
 */
function formatLastRan(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `last ${hh}:${mm}`;
}

/**
 * Picks the first cron trigger from a trigger list, or null if none.
 */
function firstCronTrigger(triggers: RoutineTrigger[]): RoutineTrigger | null {
  return triggers.find((t) => t.kind === "cron" && t.cronExpression != null) ?? null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  if (dataSource() !== "paperclip") {
    // ── Hermes path (existing behaviour — byte-for-byte preserved) ────────
    const data: ScheduledJobsData = {
      jobs: [
        { name: "vault-ingest", cron: "0 * * * *", last_run_label: "last 15:00 ok", next_in: "in 4m" },
        { name: "cost-report", cron: "0 23 * * *", last_run_label: "last 23:00 ok", next_in: "in 8h 4m" },
        { name: "daily-brief", cron: "0 7 * * *", last_run_label: "last 07:00 ok", next_in: "in 16h 4m" },
      ],
    };
    return NextResponse.json(data);
  }

  // ── Paperclip path ────────────────────────────────────────────────────────

  const apiUrl = process.env.PAPERCLIP_API_URL;
  const boardKey = process.env.PAPERCLIP_BOARD_KEY;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!apiUrl || !boardKey || !companyId) {
    return NextResponse.json(
      { error: "Paperclip config missing (PAPERCLIP_API_URL / PAPERCLIP_BOARD_KEY / PAPERCLIP_COMPANY_ID)" },
      { status: 503 },
    );
  }

  const client = createPaperclipClient({ apiUrl, boardKey, companyId });
  const result = await client.routines();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  // Map routines with a cron trigger to the ScheduledJob shape.
  const routineJobs: ScheduledJob[] = result.data.flatMap((routine) => {
    const cronTrigger = firstCronTrigger(routine.triggers);
    if (!cronTrigger || !cronTrigger.cronExpression) return [];

    // next_in: derive from trigger.nextRunAt if available.
    const next_in = cronTrigger.nextRunAt ? formatNextIn(cronTrigger.nextRunAt) : "—";

    // last_run_label: prefer trigger.lastFiredAt (most authoritative for when
    // the cron trigger actually fired); fallback to "—" if not available.
    // NOTE: Routine.lastRun exposes completedAt but is typed as
    // `Record<string, unknown> | null` — accessing it requires a runtime check
    // to avoid TS errors. We prefer trigger.lastFiredAt which is typed.
    const last_run_label = cronTrigger.lastFiredAt ? formatLastRan(cronTrigger.lastFiredAt) : "—";

    return [
      {
        name: routine.title,
        cron: cronTrigger.cronExpression,
        last_run_label,
        next_in,
      },
    ];
  });

  // Merge: routines first, then static plugin-job crons.
  const jobs: ScheduledJob[] = [...routineJobs, ...STATIC_PLUGIN_JOBS];

  return NextResponse.json({ jobs });
}
