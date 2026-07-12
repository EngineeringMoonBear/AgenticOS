import { describe, it, expect } from "vitest";
import {
  getCiFailureRecord,
  upsertCiFailureRecord,
  type CiFailureRow,
} from "../src/ci-failure-store.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the `github_ci_failure` table keyed by the composite PK
 * (repo, pr). Mirrors migrations/004_ci_failure.sql column shape (snake_case).
 */
function makeStoreDb(): MappingDb & { rows: Map<string, CiFailureRow> } {
  const rows = new Map<string, CiFailureRow>();
  const pk = (repo: string, pr: number) => `${repo}|${pr}`;
  const toRaw = (r: CiFailureRow) => ({
    github_repo: r.githubRepo,
    pr_number: r.prNumber,
    head_sha: r.headSha,
    paperclip_issue_id: r.paperclipIssueId,
    status: r.status,
    updated_at: r.updatedAt,
  });
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/WHERE github_repo = \$1 AND pr_number = \$2/i.test(sql)) {
        const r = rows.get(pk(String(params?.[0]), Number(params?.[1])));
        return r ? [toRaw(r) as T] : [];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [repo, pr, headSha, issueId, status, updatedAt] = params ?? [];
        rows.set(pk(String(repo), Number(pr)), {
          githubRepo: String(repo),
          prNumber: Number(pr),
          headSha: String(headSha),
          paperclipIssueId: String(issueId),
          status: status === "closed" ? "closed" : "open",
          updatedAt: String(updatedAt),
        });
      }
      return { rowCount: 1 };
    },
  };
}

const ROW: CiFailureRow = {
  githubRepo: "Goldberry-Playground/AgenticOS",
  prNumber: 42,
  headSha: "abc1234def5678",
  paperclipIssueId: "pi-ci-1",
  status: "open",
  updatedAt: "2026-07-12T00:00:00Z",
};

describe("ci-failure-store round-trip", () => {
  it("upserts then reads back by (repo, pr)", async () => {
    const db = makeStoreDb();
    await upsertCiFailureRecord(db, ROW);
    expect(await getCiFailureRecord(db, ROW.githubRepo, ROW.prNumber)).toEqual(ROW);
  });

  it("returns null for a (repo, pr) with no row", async () => {
    const db = makeStoreDb();
    await upsertCiFailureRecord(db, ROW);
    expect(await getCiFailureRecord(db, ROW.githubRepo, 999)).toBeNull();
  });

  it("upsert replaces in place (status open→closed, new head) — one row", async () => {
    const db = makeStoreDb();
    await upsertCiFailureRecord(db, ROW);
    await upsertCiFailureRecord(db, {
      ...ROW,
      headSha: "deadbeefdeadbeef",
      status: "closed",
      updatedAt: "2026-07-12T01:00:00Z",
    });
    const found = await getCiFailureRecord(db, ROW.githubRepo, ROW.prNumber);
    expect(found?.status).toBe("closed");
    expect(found?.headSha).toBe("deadbeefdeadbeef");
    expect(db.rows.size).toBe(1);
  });
});
