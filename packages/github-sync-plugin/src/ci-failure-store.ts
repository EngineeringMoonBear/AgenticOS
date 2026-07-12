/**
 * `github_ci_failure` store (GOL-305). One row per (repo, PR#) records the head
 * SHA last acted on, the Paperclip fix-issue id, and whether that issue is
 * currently `open` or `closed`. This is the loop-guard for the CI→Paperclip fix
 * loop:
 *   - no row / row `closed` + red CI   → create a fix issue (first failure or a
 *                                         re-fail after a prior green auto-close)
 *   - row `open`         + red CI       → update the existing fix issue in place
 *   - row `open`         + green CI     → auto-close the fix issue (status done)
 *   - row `closed`/none  + green CI     → no-op (nothing to close)
 *
 * Schema-qualified with the plugin namespace (created by migrations/004_ci_failure.sql)
 * — the plugin-DB contract forbids runtime DDL and requires qualified names.
 */
import type { MappingDb } from "./mapping.js";

export const CI_FAILURE_TABLE = "github_ci_failure";

/** Whether the fix issue for a (repo, PR#) is currently open or resolved/closed. */
export type CiFailureStatus = "open" | "closed";

export interface CiFailureRow {
  githubRepo: string;
  prNumber: number;
  headSha: string;
  paperclipIssueId: string;
  status: CiFailureStatus;
  updatedAt: string;
}

function qualified(db: MappingDb): string {
  return `${db.namespace}.${CI_FAILURE_TABLE}`;
}

function toRow(raw: Record<string, unknown>): CiFailureRow {
  return {
    githubRepo: String(raw.github_repo),
    prNumber: Number(raw.pr_number),
    headSha: String(raw.head_sha),
    paperclipIssueId: String(raw.paperclip_issue_id),
    status: raw.status === "closed" ? "closed" : "open",
    updatedAt: String(raw.updated_at),
  };
}

/** The fix-issue record for one (repo, PR#), or null if none yet. */
export async function getCiFailureRecord(
  db: MappingDb,
  githubRepo: string,
  prNumber: number,
): Promise<CiFailureRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT github_repo, pr_number, head_sha, paperclip_issue_id, status, updated_at
       FROM ${qualified(db)}
      WHERE github_repo = $1 AND pr_number = $2`,
    [githubRepo, prNumber],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/** Create or update the fix-issue record (upsert by the composite PK). */
export async function upsertCiFailureRecord(db: MappingDb, row: CiFailureRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualified(db)}
       (github_repo, pr_number, head_sha, paperclip_issue_id, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (github_repo, pr_number) DO UPDATE SET
       head_sha = $3,
       paperclip_issue_id = $4,
       status = $5,
       updated_at = $6`,
    [row.githubRepo, row.prNumber, row.headSha, row.paperclipIssueId, row.status, row.updatedAt],
  );
}
