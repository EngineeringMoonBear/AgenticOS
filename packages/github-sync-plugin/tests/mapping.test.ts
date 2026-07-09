import { describe, it, expect } from "vitest";
import {
  getByPaperclipId,
  getByRepoNumber,
  bareRepoName,
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
      // getByRepoNumber: match on number + bare-repo normalisation (both sides).
      if (/SELECT/i.test(q) && /github_issue_number = \$1/i.test(q) && /regexp_replace/i.test(q)) {
        const num = Number(params?.[0]);
        const bare = String(params?.[1]).toLowerCase();
        const match = [...rows.values()].find(
          (r) => r.githubIssueNumber === num && bareRepoName(r.githubRepo).toLowerCase() === bare,
        );
        if (!match) return [];
        return [
          {
            paperclip_issue_id: match.paperclipIssueId,
            github_repo: match.githubRepo,
            github_issue_number: match.githubIssueNumber,
            last_synced_at: match.lastSyncedAt,
            origin: match.origin,
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

describe("bareRepoName", () => {
  it("strips a leading owner/ and leaves bare names untouched", () => {
    expect(bareRepoName("Goldberry-Playground/grove-sites")).toBe("grove-sites");
    expect(bareRepoName("grove-sites")).toBe("grove-sites");
    expect(bareRepoName("EngineeringMoonBear/AgenticOS")).toBe("AgenticOS");
  });
});

describe("getByRepoNumber — org-qualified ↔ bare normalisation", () => {
  it("finds a Paperclip-origin row (stored bare) from an org-qualified App-webhook repo", async () => {
    // Outbound sync records the bare repo name from bridge config…
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-42",
      githubRepo: "grove-sites",
      githubIssueNumber: 271,
      lastSyncedAt: "2026-07-09T00:00:00Z",
      origin: "paperclip",
    });
    // …and GitHub's native `issues` webhook reports `owner/repo`. Closure lookup must still hit.
    const found = await getByRepoNumber(db, "Goldberry-Playground/grove-sites", 271);
    expect(found?.paperclipIssueId).toBe("pi-42");
  });

  it("finds an inbound row (stored org-qualified) from a bare repo lookup", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-7",
      githubRepo: "Goldberry-Playground/grove-sites",
      githubIssueNumber: 8,
      lastSyncedAt: "2026-07-09T00:00:00Z",
      origin: "github",
    });
    const found = await getByRepoNumber(db, "grove-sites", 8);
    expect(found?.paperclipIssueId).toBe("pi-7");
  });

  it("does not cross-match a different repo with the same issue number", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-9",
      githubRepo: "grove-odoo-modules",
      githubIssueNumber: 1,
      lastSyncedAt: "2026-07-09T00:00:00Z",
      origin: "paperclip",
    });
    expect(await getByRepoNumber(db, "grove-sites", 1)).toBeNull();
  });
});
