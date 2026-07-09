/**
 * `github_pr_review` store (GOL-158). One row per (repo, PR, reviewer) records
 * the head SHA last acted on plus the Paperclip review-issue id, giving the PR
 * pipeline its idempotency + reopen semantics:
 *   - no row            → create the review issue (first time this reviewer sees the PR)
 *   - row, same headSha → redelivery, no-op
 *   - row, new headSha  → synchronize/new-commits: reopen the review issue, reset the check
 *
 * Schema-qualified with the plugin namespace (created by migrations/002_pr_review.sql)
 * — the plugin-DB contract forbids runtime DDL and requires qualified names.
 */
import type { MappingDb } from "./mapping.js";

export const PR_REVIEW_TABLE = "github_pr_review";

export interface PrReviewRow {
  githubRepo: string;
  prNumber: number;
  reviewer: string;
  headSha: string;
  paperclipIssueId: string;
  updatedAt: string;
}

function qualified(db: MappingDb): string {
  return `${db.namespace}.${PR_REVIEW_TABLE}`;
}

function toRow(raw: Record<string, unknown>): PrReviewRow {
  return {
    githubRepo: String(raw.github_repo),
    prNumber: Number(raw.pr_number),
    reviewer: String(raw.reviewer),
    headSha: String(raw.head_sha),
    paperclipIssueId: String(raw.paperclip_issue_id),
    updatedAt: String(raw.updated_at),
  };
}

/** The review record for one (repo, PR, reviewer), or null if none yet. */
export async function getReviewRecord(
  db: MappingDb,
  githubRepo: string,
  prNumber: number,
  reviewer: string,
): Promise<PrReviewRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at
       FROM ${qualified(db)}
      WHERE github_repo = $1 AND pr_number = $2 AND reviewer = $3`,
    [githubRepo, prNumber, reviewer],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/**
 * Reverse lookup: the review record whose Paperclip review-issue is `paperclipIssueId`,
 * or null (GOL-186). Each review issue belongs to exactly one (repo, PR, reviewer)
 * row — one issue per reviewer — so at most one row matches. The sign-off path uses
 * this to turn an `issue.updated` on a review issue back into its (repo, PR) so it
 * can load the sibling reviewer's row and evaluate the merge gate.
 */
export async function getReviewRecordByIssueId(
  db: MappingDb,
  paperclipIssueId: string,
): Promise<PrReviewRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at
       FROM ${qualified(db)}
      WHERE paperclip_issue_id = $1
      LIMIT 1`,
    [paperclipIssueId],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/** Create or update the review record (upsert by the composite PK). */
export async function upsertReviewRecord(db: MappingDb, row: PrReviewRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualified(db)}
       (github_repo, pr_number, reviewer, head_sha, paperclip_issue_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (github_repo, pr_number, reviewer) DO UPDATE SET
       head_sha = $4,
       paperclip_issue_id = $5,
       updated_at = $6`,
    [row.githubRepo, row.prNumber, row.reviewer, row.headSha, row.paperclipIssueId, row.updatedAt],
  );
}
