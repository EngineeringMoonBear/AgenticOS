import type { Result } from "../viking-client.js";
import { diff, type VaultFile } from "./reconcile.js";
import { vikingUriFor } from "./viking-uri.js";

/**
 * Minimal database surface the job needs — a structural subset of
 * `PluginDatabaseClient` (ctx.db) so the job is testable with an in-memory fake.
 *
 * The vault_ingest_state table is created by `migrations/001_init.sql` (the
 * Paperclip plugin-DB contract forbids runtime DDL — `ctx.db.execute` rejects
 * CREATE/ALTER/DROP). Every runtime statement must be SCHEMA-QUALIFIED with the
 * host-derived namespace, which the SDK exposes as `ctx.db.namespace`.
 */
export interface IngestDb {
  /** Host-derived Postgres schema for this plugin (ctx.db.namespace). */
  namespace: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

/** The slice of VikingClient the job depends on (resource API only). */
export interface IngestViking {
  addResource(content: string, filename: string, vikingUri: string): Promise<Result<void>>;
  rm(vikingUri: string): Promise<Result<void>>;
}

export interface RunVaultIngestDeps {
  reader: (vaultServerUrl: string) => Promise<Result<VaultFile[]>>;
  viking: IngestViking;
  db: IngestDb;
  vaultServerUrl: string;
}

export interface VaultIngestSummary {
  added: number;
  updated: number;
  removed: number;
  errors: number;
}

const STATE_TABLE = "vault_ingest_state";

/** Fully-qualified `<namespace>.vault_ingest_state` for runtime SQL. */
function qualifiedTable(db: IngestDb): string {
  return `${db.namespace}.${STATE_TABLE}`;
}

/** Last path segment (POSIX) — used as the multipart filename. */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/**
 * vault-ingest run: read the vault, diff against prior path→sha state in the
 * plugin DB, push adds/updates as OpenViking resources, remove deletions, and
 * reconcile the state table.
 *
 * Per-file errors are isolated (collected into the count, never abort the run),
 * mirroring github's pr-triage handler.
 */
export async function runVaultIngest(
  deps: RunVaultIngestDeps,
): Promise<VaultIngestSummary> {
  const { reader, viking, db, vaultServerUrl } = deps;
  const summary: VaultIngestSummary = { added: 0, updated: 0, removed: 0, errors: 0 };

  // The vault_ingest_state table is created by migrations/001_init.sql, applied
  // by the host before worker init — runtime DDL is not permitted by ctx.db.

  const read = await reader(vaultServerUrl);
  if (!read.ok) {
    throw new Error(`readVault failed: ${read.error}`);
  }

  const rows = await db.query<{ path: string; sha256: string }>(
    `SELECT path, sha256 FROM ${qualifiedTable(db)}`,
  );
  const prior = new Map<string, string>(rows.map((r) => [r.path, r.sha256]));

  const { add, update, remove } = diff(read.data, prior);

  for (const file of [...add, ...update]) {
    const isAdd = prior.get(file.path) === undefined;
    try {
      const res = await viking.addResource(
        file.content,
        basename(file.path),
        vikingUriFor(file.path),
      );
      if (!res.ok) throw new Error(res.error);
      // DO UPDATE SET uses the bound $2 param rather than `excluded.sha256` —
      // the host's runtime-SQL validator only permits qualified refs inside the
      // plugin namespace, and an `excluded.col` ref could trip that check.
      await db.execute(
        `INSERT INTO ${qualifiedTable(db)} (path, sha256) VALUES ($1, $2)
           ON CONFLICT (path) DO UPDATE SET sha256 = $2`,
        [file.path, file.sha256],
      );
      if (isAdd) summary.added += 1;
      else summary.updated += 1;
    } catch {
      summary.errors += 1;
    }
  }

  for (const path of remove) {
    try {
      const res = await viking.rm(vikingUriFor(path));
      if (!res.ok) throw new Error(res.error);
      await db.execute(`DELETE FROM ${qualifiedTable(db)} WHERE path = $1`, [path]);
      summary.removed += 1;
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}
