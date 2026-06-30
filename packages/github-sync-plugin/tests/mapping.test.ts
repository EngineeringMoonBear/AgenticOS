import { describe, it, expect } from "vitest";
import {
  ensureMappingTable,
  getByPaperclipId,
  upsert,
  type MappingDb,
  type MappingRow,
} from "../src/mapping.js";

/**
 * In-memory fake of the `ctx.db` surface, keyed by Paperclip issue id. Parses
 * just enough SQL to exercise the mapping helpers (mirrors openviking's fakes).
 */
function makeFakeDb(): MappingDb & { rows: Map<string, MappingRow>; ddl: string[] } {
  const rows = new Map<string, MappingRow>();
  const ddl: string[] = [];
  return {
    rows,
    ddl,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/SELECT/i.test(sql) && /WHERE paperclip_issue_id = \$1/i.test(sql)) {
        const row = rows.get(String(params?.[0]));
        if (!row) return [];
        return [
          {
            paperclip_issue_id: row.paperclipIssueId,
            github_repo: row.githubRepo,
            github_issue_number: row.githubIssueNumber,
            last_synced_at: row.lastSyncedAt,
            origin: row.origin,
          } as T,
        ];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/CREATE TABLE/i.test(sql)) {
        ddl.push(sql);
        return { rowCount: 0 };
      }
      if (/INSERT INTO/i.test(sql)) {
        const [id, repo, num, syncedAt, origin] = params ?? [];
        rows.set(String(id), {
          paperclipIssueId: String(id),
          githubRepo: String(repo),
          githubIssueNumber: Number(num),
          lastSyncedAt: String(syncedAt),
          origin: origin === "github" ? "github" : "paperclip",
        });
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };
}

describe("mapping", () => {
  it("ensureMappingTable issues idempotent CREATE TABLE IF NOT EXISTS", async () => {
    const db = makeFakeDb();
    await ensureMappingTable(db);
    expect(db.ddl).toHaveLength(1);
    expect(db.ddl[0]).toMatch(/CREATE TABLE IF NOT EXISTS github_sync_mapping/);
  });

  it("getByPaperclipId returns null when no row exists", async () => {
    const db = makeFakeDb();
    expect(await getByPaperclipId(db, "missing")).toBeNull();
  });

  it("upsert inserts then updates by primary key", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-1",
      githubRepo: "repo",
      githubIssueNumber: 10,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    let row = await getByPaperclipId(db, "pi-1");
    expect(row).toMatchObject({ githubIssueNumber: 10, origin: "paperclip" });

    await upsert(db, {
      paperclipIssueId: "pi-1",
      githubRepo: "repo",
      githubIssueNumber: 10,
      lastSyncedAt: "2026-02-02T00:00:00Z",
      origin: "paperclip",
    });
    row = await getByPaperclipId(db, "pi-1");
    expect(row?.lastSyncedAt).toBe("2026-02-02T00:00:00Z");
    expect(db.rows.size).toBe(1);
  });
});
