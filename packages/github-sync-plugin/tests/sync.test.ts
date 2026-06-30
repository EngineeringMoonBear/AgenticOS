import { describe, it, expect, vi } from "vitest";
import type { Issue } from "@paperclipai/plugin-sdk";
import {
  statusToGithubState,
  detectGithubMarker,
  paperclipMarker,
  buildGithubBody,
  handleIssueCreated,
  handleIssueUpdated,
  type SyncDeps,
  type SyncConfig,
  type SyncLogger,
} from "../src/sync.js";
import type { GitHubClient } from "../src/github-client.js";
import { getByPaperclipId, upsert, type MappingDb, type MappingRow } from "../src/mapping.js";

const CONFIG: SyncConfig = {
  githubRepo: "target-repo",
  syncLabelPaperclip: "synced-from-paperclip",
  syncMarkerGithub: "synced-from-github",
};

const silentLogger: SyncLogger = { info() {}, warn() {}, error() {} };

function makeFakeDb(): MappingDb & { rows: Map<string, MappingRow> } {
  const rows = new Map<string, MappingRow>();
  return {
    namespace: "plugin_github_sync_40eceaaa3a",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/WHERE paperclip_issue_id = \$1/i.test(sql)) {
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
      if (/INSERT INTO/i.test(sql)) {
        const [id, repo, num, syncedAt, origin] = params ?? [];
        rows.set(String(id), {
          paperclipIssueId: String(id),
          githubRepo: String(repo),
          githubIssueNumber: Number(num),
          lastSyncedAt: String(syncedAt),
          origin: origin === "github" ? "github" : "paperclip",
        });
      }
      return { rowCount: 1 };
    },
  };
}

function makeIssue(overrides: Partial<Issue>): Issue {
  return {
    id: "pi-1",
    companyId: "co-1",
    title: "A native issue",
    description: "Some details",
    status: "todo",
    identifier: "ENG-12",
    ...overrides,
  } as Issue;
}

function makeGithub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    getIssue: vi.fn(),
    ...overrides,
  } as unknown as GitHubClient;
}

describe("statusToGithubState", () => {
  it("maps done/cancelled to closed, everything else to open", () => {
    expect(statusToGithubState("done")).toBe("closed");
    expect(statusToGithubState("cancelled")).toBe("closed");
    expect(statusToGithubState("todo")).toBe("open");
    expect(statusToGithubState("in_progress")).toBe("open");
    expect(statusToGithubState("backlog")).toBe("open");
    expect(statusToGithubState("in_review")).toBe("open");
    expect(statusToGithubState("blocked")).toBe("open");
  });
});

describe("detectGithubMarker", () => {
  it("parses repo and number from the inbound marker", () => {
    expect(detectGithubMarker("body\n<!-- synced-from-github: my-repo#321 -->")).toEqual({
      repo: "my-repo",
      number: 321,
    });
  });
  it("returns null when no marker / empty description", () => {
    expect(detectGithubMarker("just a normal description")).toBeNull();
    expect(detectGithubMarker(null)).toBeNull();
    expect(detectGithubMarker(undefined)).toBeNull();
  });
});

describe("buildGithubBody", () => {
  it("includes the description, a back-link footer, and the paperclip marker", () => {
    const body = buildGithubBody(makeIssue({ id: "pi-9", identifier: "ENG-9", description: "Fix it" }));
    expect(body).toContain("Fix it");
    expect(body).toContain("Paperclip issue ENG-9");
    expect(body).toContain(paperclipMarker("pi-9"));
  });
});

describe("handleIssueCreated — loop prevention", () => {
  it("creates a GitHub issue for a NATIVE Paperclip issue (no marker)", async () => {
    const db = makeFakeDb();
    const createIssue = vi.fn().mockResolvedValue({
      ok: true,
      data: { number: 100, title: "", body: "", state: "open", htmlUrl: "", labels: [] },
    });
    const github = makeGithub({ createIssue });
    const deps: SyncDeps = {
      db,
      github,
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-1", description: "native, no marker" }),
    };

    await handleIssueCreated(deps, { issueId: "pi-1", companyId: "co-1" });

    expect(createIssue).toHaveBeenCalledTimes(1);
    const [repo, payload] = createIssue.mock.calls[0];
    expect(repo).toBe("target-repo");
    expect(payload.labels).toEqual(["synced-from-paperclip"]);

    const mapping = await getByPaperclipId(db, "pi-1");
    expect(mapping).toMatchObject({ githubIssueNumber: 100, origin: "paperclip" });
  });

  it("does NOT create a GitHub issue for a GitHub-originated issue (marker present)", async () => {
    const db = makeFakeDb();
    const createIssue = vi.fn();
    const github = makeGithub({ createIssue });
    const deps: SyncDeps = {
      db,
      github,
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () =>
        makeIssue({
          id: "pi-2",
          description: "from gh\n<!-- synced-from-github: up-repo#55 -->",
        }),
    };

    await handleIssueCreated(deps, { issueId: "pi-2", companyId: "co-1" });

    expect(createIssue).not.toHaveBeenCalled();
    const mapping = await getByPaperclipId(db, "pi-2");
    expect(mapping).toMatchObject({ githubRepo: "up-repo", githubIssueNumber: 55, origin: "github" });
  });

  it("skips when the issue is already mapped (idempotent)", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-3",
      githubRepo: "target-repo",
      githubIssueNumber: 7,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const createIssue = vi.fn();
    const getIssue = vi.fn();
    const deps: SyncDeps = {
      db,
      github: makeGithub({ createIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue,
    };

    await handleIssueCreated(deps, { issueId: "pi-3", companyId: "co-1" });

    expect(createIssue).not.toHaveBeenCalled();
    expect(getIssue).not.toHaveBeenCalled();
  });
});

describe("handleIssueUpdated", () => {
  it("pushes the diff to GitHub for a mapped issue and bumps last_synced_at", async () => {
    const db = makeFakeDb();
    await upsert(db, {
      paperclipIssueId: "pi-4",
      githubRepo: "target-repo",
      githubIssueNumber: 200,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      origin: "paperclip",
    });
    const updateIssue = vi.fn().mockResolvedValue({
      ok: true,
      data: { number: 200, title: "", body: "", state: "closed", htmlUrl: "", labels: [] },
    });
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue: async () => makeIssue({ id: "pi-4", status: "done", title: "Updated title" }),
    };

    await handleIssueUpdated(deps, { issueId: "pi-4", companyId: "co-1" });

    expect(updateIssue).toHaveBeenCalledTimes(1);
    const [repo, num, payload] = updateIssue.mock.calls[0];
    expect(repo).toBe("target-repo");
    expect(num).toBe(200);
    expect(payload.state).toBe("closed");
    expect(payload.title).toBe("Updated title");

    const mapping = await getByPaperclipId(db, "pi-4");
    expect(mapping?.lastSyncedAt).not.toBe("2026-01-01T00:00:00Z");
  });

  it("ignores updates for unmapped issues", async () => {
    const db = makeFakeDb();
    const updateIssue = vi.fn();
    const getIssue = vi.fn();
    const deps: SyncDeps = {
      db,
      github: makeGithub({ updateIssue }),
      config: CONFIG,
      logger: silentLogger,
      getIssue,
    };

    await handleIssueUpdated(deps, { issueId: "unmapped", companyId: "co-1" });

    expect(updateIssue).not.toHaveBeenCalled();
    expect(getIssue).not.toHaveBeenCalled();
  });
});
