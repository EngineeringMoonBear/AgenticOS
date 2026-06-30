/**
 * `github_sync_mapping` — the plugin-DB-namespace link between a Paperclip issue
 * and its mirrored GitHub issue, plus the sync origin used for loop prevention.
 *
 * Structural subset of `PluginDatabaseClient` (ctx.db) so callers/tests can pass
 * an in-memory fake, mirroring openviking-plugin's `IngestDb`.
 */
export interface MappingDb {
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

/**
 * Idempotent DDL — avoids a formal migration. Requires the
 * database.namespace.migrate capability (see manifest). Safe to call on every
 * worker start.
 */
export async function ensureMappingTable(db: MappingDb): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${MAPPING_TABLE} (
       paperclip_issue_id TEXT PRIMARY KEY,
       github_repo TEXT NOT NULL,
       github_issue_number INTEGER NOT NULL,
       last_synced_at TEXT NOT NULL,
       origin TEXT NOT NULL
     )`,
  );
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
       FROM ${MAPPING_TABLE} WHERE paperclip_issue_id = $1`,
    [paperclipIssueId],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/** Create or replace the mapping row for a Paperclip issue (upsert by PK). */
export async function upsert(db: MappingDb, row: MappingRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${MAPPING_TABLE}
       (paperclip_issue_id, github_repo, github_issue_number, last_synced_at, origin)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(paperclip_issue_id) DO UPDATE SET
       github_repo = excluded.github_repo,
       github_issue_number = excluded.github_issue_number,
       last_synced_at = excluded.last_synced_at,
       origin = excluded.origin`,
    [
      row.paperclipIssueId,
      row.githubRepo,
      row.githubIssueNumber,
      row.lastSyncedAt,
      row.origin,
    ],
  );
}
