import { describe, it, expect } from "vitest";
import {
  getReviewRecord,
  getReviewRecordByIssueId,
  upsertReviewRecord,
  type PrReviewRow,
} from "../src/pr-review-store.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the `github_pr_review` table keyed by the composite PK
 * (repo, pr, reviewer), matching the three statements the store issues: the
 * (repo,pr,reviewer) SELECT, the paperclip_issue_id reverse SELECT, and the
 * upsert INSERT. Column shape mirrors migrations/002_pr_review.sql (snake_case).
 */
function makeStoreDb(): MappingDb & { rows: Map<string, PrReviewRow> } {
  const rows = new Map<string, PrReviewRow>();
  const pk = (repo: string, pr: number, reviewer: string) => `${repo}|${pr}|${reviewer}`;
  const toRaw = (r: PrReviewRow) => ({
    github_repo: r.githubRepo,
    pr_number: r.prNumber,
    reviewer: r.reviewer,
    head_sha: r.headSha,
    paperclip_issue_id: r.paperclipIssueId,
    updated_at: r.updatedAt,
  });
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/WHERE paperclip_issue_id = \$1/i.test(sql)) {
        const id = String(params?.[0]);
        for (const r of rows.values()) if (r.paperclipIssueId === id) return [toRaw(r) as T];
        return [];
      }
      if (/WHERE github_repo = \$1 AND pr_number = \$2 AND reviewer = \$3/i.test(sql)) {
        const r = rows.get(pk(String(params?.[0]), Number(params?.[1]), String(params?.[2])));
        return r ? [toRaw(r) as T] : [];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [repo, pr, reviewer, headSha, issueId, updatedAt] = params ?? [];
        rows.set(pk(String(repo), Number(pr), String(reviewer)), {
          githubRepo: String(repo),
          prNumber: Number(pr),
          reviewer: String(reviewer),
          headSha: String(headSha),
          paperclipIssueId: String(issueId),
          updatedAt: String(updatedAt),
        });
      }
      return { rowCount: 1 };
    },
  };
}

const ROW: PrReviewRow = {
  githubRepo: "EngineeringMoonBear/AgenticOS",
  prNumber: 295,
  reviewer: "alice",
  headSha: "201ce63aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  paperclipIssueId: "pi-alice-1",
  updatedAt: "2026-07-09T00:00:00Z",
};

describe("pr-review-store round-trip", () => {
  it("upserts then reads back by (repo, pr, reviewer)", async () => {
    const db = makeStoreDb();
    await upsertReviewRecord(db, ROW);
    expect(await getReviewRecord(db, ROW.githubRepo, ROW.prNumber, "alice")).toEqual(ROW);
  });

  it("returns null for a (repo, pr, reviewer) with no row", async () => {
    const db = makeStoreDb();
    await upsertReviewRecord(db, ROW);
    expect(await getReviewRecord(db, ROW.githubRepo, ROW.prNumber, "iris")).toBeNull();
  });
});

describe("getReviewRecordByIssueId — reverse lookup (GOL-186)", () => {
  it("finds the row for its Paperclip review-issue id", async () => {
    const db = makeStoreDb();
    await upsertReviewRecord(db, ROW);
    expect(await getReviewRecordByIssueId(db, "pi-alice-1")).toEqual(ROW);
  });

  it("returns null when no row maps to the issue id", async () => {
    const db = makeStoreDb();
    await upsertReviewRecord(db, ROW);
    expect(await getReviewRecordByIssueId(db, "pi-unknown")).toBeNull();
  });

  it("reflects the CURRENT head SHA after a synchronize upsert (no stale head)", async () => {
    const db = makeStoreDb();
    await upsertReviewRecord(db, ROW);
    // synchronize: same issue reused, new head SHA + updatedAt (worker resets the row).
    const newHead = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    await upsertReviewRecord(db, { ...ROW, headSha: newHead, updatedAt: "2026-07-09T01:00:00Z" });
    const found = await getReviewRecordByIssueId(db, "pi-alice-1");
    expect(found?.headSha).toBe(newHead);
    // exactly one row for the reviewer — the upsert replaced, not appended.
    expect(db.rows.size).toBe(1);
  });
});
