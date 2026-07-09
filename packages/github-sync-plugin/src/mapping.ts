/**
 * `github_sync_mapping` — the plugin-DB-namespace link between a Paperclip issue
 * and its mirrored GitHub issue, plus the sync origin used for loop prevention.
 *
 * The table is created by `migrations/001_init.sql` (the Paperclip plugin-DB
 * contract forbids runtime DDL — `ctx.db.execute` rejects CREATE/ALTER/DROP).
 * Every runtime statement must be SCHEMA-QUALIFIED with the host-derived
 * namespace, which the SDK exposes as `ctx.db.namespace`.
 */
export interface MappingDb {
  /** Host-derived Postgres schema for this plugin (ctx.db.namespace). */
  namespace: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

/** Where a synced issue first originated. */
export type SyncOrigin = "paperclip" | "github";

export interface MappingRow {
  paperclipIssueId: string;
  githubRepo: string;
  githubIssueNumber: number;
  lastSyncedAt: string;
  origin: SyncOrigin;
}

export const MAPPING_TABLE = "github_sync_mapping";

/** Fully-qualified `<namespace>.github_sync_mapping` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${MAPPING_TABLE}`;
}

function toRow(raw: Record<string, unknown>): MappingRow {
  return {
    paperclipIssueId: String(raw.paperclip_issue_id),
    githubRepo: String(raw.github_repo),
    githubIssueNumber: Number(raw.github_issue_number),
    lastSyncedAt: String(raw.last_synced_at),
    origin: raw.origin === "github" ? "github" : "paperclip",
  };
}

/** Look up the mapping for a Paperclip issue, or null if none exists. */
export async function getByPaperclipId(
  db: MappingDb,
  paperclipIssueId: string,
): Promise<MappingRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin
       FROM ${qualifiedTable(db)} WHERE paperclip_issue_id = $1`,
    [paperclipIssueId],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/** Strip any leading `owner/` so `org/repo` and a bare `repo` compare equal. */
export function bareRepoName(githubRepo: string): string {
  const slash = githubRepo.lastIndexOf("/");
  return slash >= 0 ? githubRepo.slice(slash + 1) : githubRepo;
}

/**
 * Look up the mapping for a GitHub issue (`<repo>#<number>`), or null.
 * Used by the inbound webhook to dedupe redeliveries before creating a mirror,
 * and by closure propagation to find the mirror of a just-closed GitHub issue.
 *
 * Repo matching is normalised to the bare repo name on both sides: outbound
 * (Paperclip-origin) rows record `github_repo` as the bare name from the bridge
 * config (e.g. `grove-sites`), while GitHub's native App webhook reports the
 * fully-qualified `owner/repo` (e.g. `Goldberry-Playground/grove-sites`). A raw
 * `github_repo = $1` compare would miss those rows and closure would never
 * propagate — issue numbers are already scoped per repo so the bare-name match
 * is unambiguous within a bridge.
 */
export async function getByRepoNumber(
  db: MappingDb,
  githubRepo: string,
  githubIssueNumber: number,
): Promise<MappingRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin
       FROM ${qualifiedTable(db)}
      WHERE github_issue_number = $1
        AND lower(regexp_replace(github_repo, '^[^/]+/', '')) = lower($2)`,
    [githubIssueNumber, bareRepoName(githubRepo)],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/**
 * Create or replace the mapping row for a Paperclip issue (upsert by PK).
 *
 * The `DO UPDATE SET` uses the bound parameters directly rather than `excluded.*`
 * — the host's runtime-SQL validator only permits qualified refs inside the
 * plugin namespace, and an `excluded.col` ref could trip that check.
 */
export async function upsert(db: MappingDb, row: MappingRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)}
       (paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (paperclip_issue_id) DO UPDATE SET
       github_repo = $2,
       github_issue_number = $3,
       last_synced_at = $4,
       origin = $5`,
    [
      row.paperclipIssueId,
      row.githubRepo,
      row.githubIssueNumber,
      row.lastSyncedAt,
      row.origin,
    ],
  );
}
