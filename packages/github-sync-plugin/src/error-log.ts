/**
 * `github_sync_error` — the plugin-owned, queryable sink for SWALLOWED worker
 * failures (GOL-296). A caught exception in `onWebhook` or an event dispatch used
 * to reach only host stderr (server.log); this table gives a durable, queryable
 * record (`recentErrors`) reachable over DATABASE_URL without a server.log dig.
 *
 * Created by `migrations/003_error_log.sql` (the plugin-DB contract forbids runtime
 * DDL). Every statement is SCHEMA-QUALIFIED with the host-derived namespace, which
 * the SDK exposes as `ctx.db.namespace`. Reuses the `MappingDb` surface so the same
 * `ctx.db` handle backs mappings, PR-review rows, and error records.
 */
import type { MappingDb } from "./mapping.js";

export const ERROR_TABLE = "github_sync_error";

export interface ErrorRow {
  /** ISO-8601 timestamp the failure was caught. */
  occurredAt: string;
  /** Short scope/label, e.g. "inbound webhook: handler failed (github-app)". */
  scope: string;
  /** The error message (or String(err) for non-Errors). */
  detail: string;
  /** Optional structured side-context (endpointKey, issueId, …). */
  context?: Record<string, unknown>;
}

/** Fully-qualified `<namespace>.github_sync_error` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${ERROR_TABLE}`;
}

/**
 * 🚨 alert for a swallowed worker failure (GOL-296), posted to the Discord ops
 * webhook. A distinct emoji/prefix so it stands out from routine ops pings; the
 * detail is truncated so a giant stack/message never blows Discord's 2000-char
 * `content` limit. Lives here (not worker.ts) so it's unit-testable without
 * importing the worker entrypoint, which calls runWorker() at module load.
 */
export function buildSwallowedFailurePing(scope: string, detail: string): string {
  const trimmed = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail;
  return `🚨 github-sync failure — ${scope}: ${trimmed}`;
}

/**
 * Persist one swallowed-failure record. Callers wrap this in try/catch — the
 * failure being reported must never be masked by a secondary failure writing it
 * down (a DB outage is itself a likely root cause of the failure being recorded).
 */
export async function recordError(db: MappingDb, row: ErrorRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)} (occurred_at, scope, detail, context)
       VALUES ($1, $2, $3, $4)`,
    [
      row.occurredAt,
      row.scope,
      row.detail,
      row.context && Object.keys(row.context).length > 0 ? JSON.stringify(row.context) : null,
    ],
  );
}

/**
 * Most-recent swallowed failures first — the queryable read side. Backs ad-hoc
 * `SELECT` triage today; a future `GET /api/plugins/:id/logs`-style endpoint (or a
 * host plugin_logs wiring) can layer on top without changing the write path.
 */
export async function recentErrors(db: MappingDb, limit = 50): Promise<ErrorRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT occurred_at, scope, detail, context
       FROM ${qualifiedTable(db)} ORDER BY occurred_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    occurredAt: String(r.occurred_at),
    scope: String(r.scope),
    detail: String(r.detail),
    context: r.context != null ? safeParseContext(String(r.context)) : undefined,
  }));
}

function safeParseContext(raw: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
