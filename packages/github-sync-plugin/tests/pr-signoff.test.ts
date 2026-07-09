import { describe, it, expect, vi } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import { evaluateSignoffGate } from "../src/pr-review.js";
import { handleReviewSignoff } from "../src/pr-signoff.js";
import type { SyncConfig, SyncDeps, SyncLogger } from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";
import { upsertReviewRecord, type PrReviewRow } from "../src/pr-review-store.js";
import type { MappingDb } from "../src/mapping.js";

// --- pure gate truth table -------------------------------------------------------

describe("evaluateSignoffGate — Phase 3 merge gate (GOL-186)", () => {
  it("alice-only PR: alice done → alice green", () => {
    expect(evaluateSignoffGate({ aliceDone: true, irisPresent: false, irisDone: false })).toEqual(["alice"]);
  });

  it("alice-only PR: alice not done → nothing", () => {
    expect(evaluateSignoffGate({ aliceDone: false, irisPresent: false, irisDone: false })).toEqual([]);
  });

  it("alice+iris: iris pending → neither green (alice gated on iris)", () => {
    expect(evaluateSignoffGate({ aliceDone: true, irisPresent: true, irisDone: false })).toEqual([]);
  });

  it("alice+iris: iris done, alice pending → iris green only", () => {
    expect(evaluateSignoffGate({ aliceDone: false, irisPresent: true, irisDone: true })).toEqual(["iris"]);
  });

  it("alice+iris: both done → both green (converges regardless of order)", () => {
    expect(evaluateSignoffGate({ aliceDone: true, irisPresent: true, irisDone: true })).toEqual(["iris", "alice"]);
  });
});

// --- handler wiring --------------------------------------------------------------

const CONFIG: SyncConfig = {
  githubRepo: "AgenticOS", // bare repo name used for the check-run API path
  syncLabelPaperclip: "synced-from-paperclip",
  syncMarkerGithub: "synced-from-github",
};
const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };
const REPO = "EngineeringMoonBear/AgenticOS"; // row's owner/repo (display)
const PR = 295;

function makeStoreDb(): MappingDb {
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

const ALICE_SHA = "a11ce0000000000000000000000000000000000a";
const IRIS_SHA = "1715e0000000000000000000000000000000001a";

async function seedRows(
  db: MappingDb,
  opts: { iris?: boolean; aliceHead?: string; irisHead?: string } = {},
): Promise<void> {
  await upsertReviewRecord(db, {
    githubRepo: REPO,
    prNumber: PR,
    reviewer: "alice",
    headSha: opts.aliceHead ?? ALICE_SHA,
    paperclipIssueId: "pi-alice",
    updatedAt: "2026-07-09T00:00:00Z",
  });
  if (opts.iris) {
    await upsertReviewRecord(db, {
      githubRepo: REPO,
      prNumber: PR,
      reviewer: "iris",
      headSha: opts.irisHead ?? IRIS_SHA,
      paperclipIssueId: "pi-iris",
      updatedAt: "2026-07-09T00:00:00Z",
    });
  }
}

/** getIssue backed by a status map keyed on issue id. */
function issueGetter(statuses: Record<string, Issue["status"]>) {
  return async (issueId: string): Promise<Issue | null> => {
    const status = statuses[issueId];
    if (!status) return null;
    return { id: issueId, companyId: "co-1", title: "Review", description: "", status } as Issue;
  };
}

function makeDeps(
  db: MappingDb,
  statuses: Record<string, Issue["status"]>,
  createCheckRun: ReturnType<typeof vi.fn>,
  postOpsPing?: ReturnType<typeof vi.fn>,
): SyncDeps {
  return {
    db,
    github: { createCheckRun } as unknown as GitHubClient,
    config: CONFIG,
    logger: silentLogger,
    getIssue: issueGetter(statuses),
    postOpsPing,
  };
}

const okCheck = () => vi.fn().mockResolvedValue({ ok: true, data: { id: 1 } });

describe("handleReviewSignoff", () => {
  it("ignores an issue with no review record (a mirror issue)", async () => {
    const db = makeStoreDb();
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-mirror": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-mirror", companyId: "co-1" });
    expect(createCheckRun).not.toHaveBeenCalled();
  });

  it("does nothing when the review issue is not `done` (e.g. reopened todo)", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-alice": "todo" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-alice", companyId: "co-1" });
    expect(createCheckRun).not.toHaveBeenCalled();
  });

  it("alice-only PR: alice done → posts agent-review/alice success on alice's head SHA", async () => {
    const db = makeStoreDb();
    await seedRows(db); // no iris
    const createCheckRun = okCheck();
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-alice": "done" }, createCheckRun, ping);
    await handleReviewSignoff(deps, { issueId: "pi-alice", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    const [repo, input] = createCheckRun.mock.calls[0];
    expect(repo).toBe("AgenticOS"); // bare repo, not owner/repo
    expect(input).toMatchObject({ name: "agent-review/alice", headSha: ALICE_SHA, conclusion: "success" });
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("agent-review/alice"));
  });

  it("alice+iris, alice signs off first with iris pending → posts nothing (alice gated)", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-alice": "done", "pi-iris": "todo" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-alice", companyId: "co-1" });
    expect(createCheckRun).not.toHaveBeenCalled();
  });

  it("alice+iris, iris closes last with alice already done → posts BOTH on their own head SHAs", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-alice": "done", "pi-iris": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-iris", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(2);
    const byName = Object.fromEntries(createCheckRun.mock.calls.map(([, i]) => [i.name, i]));
    expect(byName["agent-review/iris"]).toMatchObject({ headSha: IRIS_SHA, conclusion: "success" });
    expect(byName["agent-review/alice"]).toMatchObject({ headSha: ALICE_SHA, conclusion: "success" });
  });

  it("alice+iris, iris signs off first with alice pending → posts iris only", async () => {
    const db = makeStoreDb();
    await seedRows(db, { iris: true });
    const createCheckRun = okCheck();
    const deps = makeDeps(db, { "pi-alice": "todo", "pi-iris": "done" }, createCheckRun);
    await handleReviewSignoff(deps, { issueId: "pi-iris", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(createCheckRun.mock.calls[0][1]).toMatchObject({ name: "agent-review/iris", conclusion: "success" });
  });

  it("pings a pipeline error and does not throw when the check-run API fails", async () => {
    const db = makeStoreDb();
    await seedRows(db);
    const createCheckRun = vi.fn().mockResolvedValue({ ok: false, error: "HTTP 403" });
    const ping = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(db, { "pi-alice": "done" }, createCheckRun, ping);
    await handleReviewSignoff(deps, { issueId: "pi-alice", companyId: "co-1" });

    expect(createCheckRun).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("pipeline error"));
    expect(ping).toHaveBeenCalledWith(expect.stringContaining("HTTP 403"));
  });
});
