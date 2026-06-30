import { describe, it, expect } from "vitest";
import {
  getByPaperclipId,
  upsert,
  type MappingDb,
  type MappingRow,
} from "../src/mapping.js";

const NAMESPACE = "plugin_github_sync_40eceaaa3a";

/**
 * In-memory fake of the `ctx.db` surface, keyed by Paperclip issue id. Parses
 * just enough SQL to exercise the mapping helpers, and records the raw SQL so we
 * can assert it is schema-qualified with the plugin namespace.
 */
function makeFakeDb(): MappingDb & { rows: Map<string, MappingRow>; sql: string[] } {
  const rows = new Map<string, MappingRow>();
  const sql: string[] = [];
  return {
    namespace: NAMESPACE,
    rows,
    sql,
    async query<T = Record<string, unknown>>(q: string, params?: unknown[]): Promise<T[]> {
      sql.push(q);
      if (/SELECT/i.test(q) && /WHERE paperclip_issue_id = \$1/i.test(q)) {
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
    async execute(q: string, params?: unknown[]): Promise<{ rowCount: number }> {
      sql.push(q);
      if (/INSERT INTO/i.test(q)) {
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
  it("qualifies the table with the plugin namespace (host contract)", async () => {
    const db = makeFakeDb();
    await getByPaperclipId(db, "x");
    await upsert(db, {
      paperclipIssueId: "pi-1",
      githubRepo: "repo",
      githubIssueNumber: 10,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    // Every statement references `<namespace>.github_sync_mapping`, never the bare table.
    for (const q of db.sql) {
      expect(q).toContain(`${NAMESPACE}.github_sync_mapping`);
    }
  });

  it("upsert never references the `excluded` pseudo-table (validator-safe)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-1",
      githubRepo: "repo",
      githubIssueNumber: 10,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    expect(db.sql.join("\n")).not.toMatch(/excluded\./i);
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
