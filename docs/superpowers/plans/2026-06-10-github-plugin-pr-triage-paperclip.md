# GitHub Plugin — PR-Triage (Paperclip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@agenticos/github-plugin` — a Paperclip plugin with a deterministic daily scheduled job that triages open PRs across the org into a vault digest — plus the vault-server write endpoint it needs.

**Architecture:** A new TS plugin (esbuild-bundled worker, same shape as `vault-plugin`/`openviking-plugin`) exposes read-only GitHub tools and registers a `pr-triage` job (`manifest.jobs` + `ctx.jobs.register`) that runs fetch → classify → render → write entirely in code (no LLM). The digest is written to the vault via a new restricted `PUT /page` endpoint on vault-server.

**Tech Stack:** TypeScript, `@paperclipai/plugin-sdk@2026.609.0`, `fetch` (GitHub REST + vault-server), Fastify (vault-server), vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-github-plugin-pr-triage-paperclip-design.md`

**Conventions (match the repo):**
- Build/test a workspace package: `pnpm --filter @agenticos/github-plugin <build|test|typecheck>`.
- vault-server tests: `pnpm --filter @agenticos/vault-server test`.
- Commit: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit`; messages end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never push `main`; branch off `main`; squash-merge.

**Deployment note:** This plan **builds + tests** the plugin (like the two existing plugins, which are built but not yet deployed). Registering the plugin into the running Paperclip instance + injecting `GITHUB_TOKEN` is part of the broader Paperclip migration (gated on the Paperclip runtime being stood up) and is **out of scope here** — covered by §12 acceptance as a manual follow-up.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `infra/vault-server/src/routes/page-write.ts` | **New** — `PUT /page` route, restricted to a safe subtree, atomic write. |
| `infra/vault-server/src/server.ts` | **Modify** — register the new route. |
| `packages/github-plugin/package.json` · `tsconfig.json` | **New** — workspace scaffold (mirrors vault-plugin). |
| `packages/github-plugin/src/manifest.ts` | **New** — plugin manifest with `jobs` + `connector` category. |
| `packages/github-plugin/src/github-client.ts` | **New** — read-only GitHub REST client (`Result<T>`). |
| `packages/github-plugin/src/classify.ts` | **New** — pure PR bucket classifier. |
| `packages/github-plugin/src/render.ts` | **New** — deterministic digest markdown. |
| `packages/github-plugin/src/vault-writer.ts` | **New** — HTTP client to vault-server `PUT /page`. |
| `packages/github-plugin/src/worker.ts` | **New** — plugin entry: tools + `pr-triage` job. |
| `packages/github-plugin/tests/*.test.ts` | **New** — vitest unit tests (mocked `fetch`). |

---

## Task 1: vault-server — `PUT /page` write route (restricted)

**Files:**
- Create: `infra/vault-server/src/routes/page-write.ts`
- Test: `infra/vault-server/src/routes/page-write.test.ts`

- [ ] **Step 1: Write the failing test** (mirrors `discard.test.ts` — `app.inject` + tmp dir + path-safety)

Create `infra/vault-server/src/routes/page-write.test.ts`:

```ts
import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerPageWriteRoute } from "./page-write.js";

let tmp: string;
const cfg = () => ({ vaultRoot: tmp, wikiSubdir: "wiki" }) as any;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-pagewrite-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("PUT /page", () => {
  it("writes content under wiki/_meta and returns the path", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/dev-pr-digest.md", content: "# Digest\n" },
    });
    expect(res.statusCode).toBe(200);
    const written = await fs.readFile(
      path.join(tmp, "wiki/_meta/dev-pr-digest.md"),
      "utf8",
    );
    expect(written).toBe("# Digest\n");
  });

  it("rejects path traversal", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/_meta/../../escape.md", content: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects writes outside the allowed subtree", async () => {
    const app = Fastify();
    registerPageWriteRoute(app, cfg());
    const res = await app.inject({
      method: "PUT",
      url: "/page",
      payload: { path: "wiki/Software/note.md", content: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agenticos/vault-server test -- page-write`
Expected: FAIL — cannot find `./page-write.js`.

- [ ] **Step 3: Write the implementation**

Create `infra/vault-server/src/routes/page-write.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

/** Only this subtree may be written by plugins (generated artifacts). */
const ALLOWED_PREFIX = "wiki/_meta/";

interface Body {
  path?: string;
  content?: string;
}

export function registerPageWriteRoute(app: FastifyInstance, config: Config): void {
  app.put("/page", async (req, reply) => {
    const { path: relPath, content } = (req.body ?? {}) as Body;
    if (typeof relPath !== "string" || typeof content !== "string") {
      return reply.code(400).send({ error: "path and content are required" });
    }
    // Reject traversal on the RAW path (before normalize collapses `..`).
    if (relPath.split("/").some((seg) => seg === "..")) {
      return reply.code(400).send({ error: "invalid path" });
    }
    const normalized = path.posix.normalize(relPath);
    if (!normalized.startsWith(ALLOWED_PREFIX)) {
      return reply
        .code(403)
        .send({ error: `writes restricted to ${ALLOWED_PREFIX}` });
    }
    const abs = path.join(config.vaultRoot, normalized);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Atomic write + world-readable (the soak's permission lesson).
    const tmp = `${abs}.tmp`;
    await fs.writeFile(tmp, content, { encoding: "utf8", mode: 0o644 });
    await fs.rename(tmp, abs);
    await fs.chmod(abs, 0o644);
    return reply.code(200).send({ path: normalized });
  });
}
```

> Note: confirm `Config` exposes `vaultRoot` — open `infra/vault-server/src/config.ts` and match the actual field name (e.g. `vaultRoot`). If it differs, use the real name in both the route and the test `cfg()`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @agenticos/vault-server test -- page-write`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add infra/vault-server/src/routes/page-write.ts infra/vault-server/src/routes/page-write.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): restricted PUT /page write route (wiki/_meta only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: vault-server — register the route

**Files:**
- Modify: `infra/vault-server/src/server.ts`

- [ ] **Step 1: Register the route**

In `infra/vault-server/src/server.ts`, next to the other `registerXRoute(app, config)` calls (e.g. after `registerDiscardRoute(app, config);`), add the import at the top and the registration:

```ts
import { registerPageWriteRoute } from "./routes/page-write.js";
```

```ts
  registerPageWriteRoute(app, config);
```

- [ ] **Step 2: Verify the whole vault-server suite still passes**

Run: `pnpm --filter @agenticos/vault-server test`
Expected: PASS (existing tests + the 3 new ones).

- [ ] **Step 3: Commit**

```bash
git add infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): wire PUT /page route into server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: github-plugin — scaffold

**Files:**
- Create: `packages/github-plugin/package.json`, `packages/github-plugin/tsconfig.json`, `packages/github-plugin/src/manifest.ts`

- [ ] **Step 1: Create `package.json`** (copy of vault-plugin's, renamed)

```json
{
  "name": "@agenticos/github-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/worker.js",
  "scripts": {
    "build": "esbuild src/worker.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/worker.js --external:@paperclipai/plugin-sdk",
    "dev": "esbuild src/worker.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/worker.js --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "2026.609.0"
  },
  "devDependencies": {
    "@agenticos/tsconfig": "workspace:*",
    "@types/node": "^25",
    "esbuild": "^0.25.0",
    "typescript": "^6",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (identical to vault-plugin's)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@agenticos/tsconfig/base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `src/manifest.ts`** (declares the scheduled job)

```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.github-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "GitHub",
  description: "Read-only GitHub PR triage — daily digest of open PRs",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: ["jobs.schedule", "http.outbound"],
  jobs: [
    {
      jobKey: "pr-triage",
      displayName: "PR Triage",
      description: "Daily digest of open PRs across the org",
      schedule: "30 7 * * *",
    },
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
```

- [ ] **Step 4: Install + verify the workspace resolves**

Run: `pnpm install --lockfile-only && pnpm --filter @agenticos/github-plugin typecheck`
Expected: typecheck passes (manifest compiles against the SDK; `jobs` + `capabilities` are valid).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/package.json packages/github-plugin/tsconfig.json packages/github-plugin/src/manifest.ts pnpm-lock.yaml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): scaffold package + manifest with pr-triage job

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: github-client — discover open PRs

**Files:**
- Create: `packages/github-plugin/src/github-client.ts`
- Test: `packages/github-plugin/tests/github-client.test.ts`

- [ ] **Step 1: Write the failing test** (mocked global `fetch`, vault-client test style)

Create `packages/github-plugin/tests/github-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubClient } from "../src/github-client.js";

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("GitHubClient.searchOpenPrs", () => {
  it("queries the Search API and parses items", async () => {
    const fetchMock = mockFetch({
      items: [
        {
          number: 7,
          title: "Fix thing",
          user: { login: "josh" },
          draft: false,
          updated_at: "2026-06-01T00:00:00Z",
          html_url: "https://github.com/o/r/pull/7",
          repository_url: "https://api.github.com/repos/o/r",
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        repoFullName: "o/r",
        number: 7,
        author: "josh",
        draft: false,
      });
    }
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/search/issues");
    expect(String(url)).toContain("org%3Ao");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("returns an error Result on HTTP failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Bad creds" }, false, 401));
    const client = new GitHubClient({ token: "bad", org: "o", timeoutMs: 5000 });
    const result = await client.searchOpenPrs();
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agenticos/github-plugin test -- github-client`
Expected: FAIL — cannot find `../src/github-client.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/github-plugin/src/github-client.ts`:

```ts
type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

export interface GitHubClientConfig {
  token: string;
  org: string;
  timeoutMs: number;
  baseUrl?: string;
}

export interface OpenPr {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  htmlUrl: string;
}

const API_BASE = "https://api.github.com";

export class GitHubClient {
  private readonly token: string;
  private readonly org: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: GitHubClientConfig) {
    this.token = config.token;
    this.org = config.org;
    this.timeoutMs = config.timeoutMs;
    this.baseUrl = (config.baseUrl ?? API_BASE).replace(/\/$/, "");
  }

  private async get<T>(pathAndQuery: string): Promise<Result<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${pathAndQuery}`, {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      const json = (await res.json()) as T & { message?: string };
      if (!res.ok) {
        return { ok: false, error: json.message ?? `HTTP ${res.status}` };
      }
      return { ok: true, data: json };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "github unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** All open (non-archived) PRs across the org via the Search API. */
  async searchOpenPrs(): Promise<Result<OpenPr[]>> {
    const q = encodeURIComponent(
      `org:${this.org} is:pr is:open archived:false`,
    );
    const res = await this.get<{ items?: unknown[] }>(
      `/search/issues?q=${q}&per_page=100`,
    );
    if (!res.ok) return res;
    const items = (res.data.items ?? []) as Array<Record<string, any>>;
    const prs: OpenPr[] = items.map((it) => {
      const repoUrl = String(it.repository_url ?? "");
      return {
        repoFullName: repoUrl.split("/repos/")[1] ?? "",
        number: Number(it.number),
        title: String(it.title ?? ""),
        author: String(it.user?.login ?? ""),
        draft: Boolean(it.draft),
        updatedAt: String(it.updated_at ?? ""),
        htmlUrl: String(it.html_url ?? ""),
      };
    });
    return { ok: true, data: prs };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @agenticos/github-plugin test -- github-client`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/src/github-client.ts packages/github-plugin/tests/github-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): GitHubClient.searchOpenPrs (org PR discovery)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: github-client — per-PR detail, checks + review rollups

**Files:**
- Modify: `packages/github-plugin/src/github-client.ts`
- Test: `packages/github-plugin/tests/github-client.test.ts`

- [ ] **Step 1: Write the failing tests** (pure rollups + the client methods)

Append to `tests/github-client.test.ts`:

```ts
import { rollupChecks, deriveReviewState } from "../src/github-client.js";

describe("rollupChecks", () => {
  it("classifies", () => {
    expect(rollupChecks([])).toBe("none");
    expect(rollupChecks([{ status: "completed", conclusion: "success" }])).toBe("success");
    expect(
      rollupChecks([
        { status: "completed", conclusion: "success" },
        { status: "in_progress", conclusion: null },
      ]),
    ).toBe("pending");
    expect(
      rollupChecks([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ]),
    ).toBe("failure");
  });
});

describe("deriveReviewState", () => {
  it("uses latest decisive review per author", () => {
    expect(deriveReviewState([])).toBe("none");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "APPROVED", submitted_at: "2026-06-01T00:00:00Z" },
      ]),
    ).toBe("approved");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "APPROVED", submitted_at: "2026-06-01T00:00:00Z" },
        { user: { login: "a" }, state: "CHANGES_REQUESTED", submitted_at: "2026-06-02T00:00:00Z" },
      ]),
    ).toBe("changes_requested");
    expect(
      deriveReviewState([
        { user: { login: "a" }, state: "COMMENTED", submitted_at: "2026-06-01T00:00:00Z" },
      ]),
    ).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @agenticos/github-plugin test -- github-client`
Expected: FAIL — `rollupChecks`/`deriveReviewState` not exported.

- [ ] **Step 3: Write the implementation**

Append to `github-client.ts` (module-level pure functions + client methods):

```ts
const BAD_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

export function rollupChecks(
  runs: Array<{ status?: string; conclusion?: string | null }>,
): "success" | "failure" | "pending" | "none" {
  if (runs.length === 0) return "none";
  const completed = runs.filter((r) => r.status === "completed");
  if (completed.length < runs.length) return "pending";
  if (completed.some((r) => r.conclusion && BAD_CONCLUSIONS.has(r.conclusion))) {
    return "failure";
  }
  return "success";
}

export function deriveReviewState(
  reviews: Array<{ user?: { login?: string }; state?: string; submitted_at?: string }>,
): "approved" | "changes_requested" | "none" {
  const latest = new Map<string, string>();
  const sorted = [...reviews].sort((a, b) =>
    (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""),
  );
  for (const r of sorted) {
    if (r.state && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state)) {
      latest.set(r.user?.login ?? "?", r.state);
    }
  }
  const states = new Set(latest.values());
  if (states.has("CHANGES_REQUESTED")) return "changes_requested";
  if (states.has("APPROVED")) return "approved";
  return "none";
}
```

Add these methods inside the `GitHubClient` class (after `searchOpenPrs`):

```ts
  async prDetail(
    repoFullName: string,
    num: number,
  ): Promise<Result<{ mergeableState: string; headSha: string }>> {
    const res = await this.get<Record<string, any>>(
      `/repos/${repoFullName}/pulls/${num}`,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        mergeableState: String(res.data.mergeable_state ?? "unknown"),
        headSha: String(res.data.head?.sha ?? ""),
      },
    };
  }

  async prChecksState(
    repoFullName: string,
    headSha: string,
  ): Promise<Result<"success" | "failure" | "pending" | "none">> {
    if (!headSha) return { ok: true, data: "none" };
    const res = await this.get<{ check_runs?: unknown[] }>(
      `/repos/${repoFullName}/commits/${headSha}/check-runs`,
    );
    if (!res.ok) return res;
    return { ok: true, data: rollupChecks((res.data.check_runs ?? []) as any) };
  }

  async prReviewState(
    repoFullName: string,
    num: number,
  ): Promise<Result<"approved" | "changes_requested" | "none">> {
    const res = await this.get<unknown[]>(
      `/repos/${repoFullName}/pulls/${num}/reviews`,
    );
    if (!res.ok) return res;
    return { ok: true, data: deriveReviewState((res.data ?? []) as any) };
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @agenticos/github-plugin test -- github-client`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/src/github-client.ts packages/github-plugin/tests/github-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): per-PR detail + checks/review rollups

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: classify — pure bucket classifier

**Files:**
- Create: `packages/github-plugin/src/classify.ts`
- Test: `packages/github-plugin/tests/classify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/github-plugin/tests/classify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyPr, type PrFacts } from "../src/classify.js";

const NOW = new Date("2026-06-10T00:00:00Z");

function facts(over: Partial<PrFacts> = {}): PrFacts {
  return {
    repoFullName: "o/r",
    number: 1,
    title: "T",
    author: "a",
    htmlUrl: "u",
    draft: false,
    updatedAt: "2026-06-09T00:00:00Z",
    mergeableState: "clean",
    checksState: "success",
    reviewState: "approved",
    ...over,
  };
}

describe("classifyPr", () => {
  it("ready-to-merge", () => {
    expect(classifyPr(facts(), NOW, 7)).toEqual(["ready-to-merge"]);
  });
  it("ci-failing + needs-review, not ready", () => {
    const b = classifyPr(facts({ checksState: "failure", reviewState: "none" }), NOW, 7);
    expect(b).toContain("ci-failing");
    expect(b).toContain("needs-review");
    expect(b).not.toContain("ready-to-merge");
  });
  it("has-conflicts", () => {
    expect(classifyPr(facts({ mergeableState: "dirty" }), NOW, 7)).toContain("has-conflicts");
  });
  it("stale by updatedAt", () => {
    expect(classifyPr(facts({ updatedAt: "2026-05-01T00:00:00Z" }), NOW, 7)).toContain("stale");
  });
  it("draft excluded from needs-review", () => {
    const b = classifyPr(facts({ draft: true, reviewState: "none" }), NOW, 7);
    expect(b).toContain("draft");
    expect(b).not.toContain("needs-review");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @agenticos/github-plugin test -- classify`
Expected: FAIL — cannot find `../src/classify.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/github-plugin/src/classify.ts`:

```ts
export interface PrFacts {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  htmlUrl: string;
  draft: boolean;
  updatedAt: string;
  mergeableState: string;
  checksState: "success" | "failure" | "pending" | "none";
  reviewState: "approved" | "changes_requested" | "none";
}

export type Bucket =
  | "draft"
  | "ci-failing"
  | "has-conflicts"
  | "needs-review"
  | "ready-to-merge"
  | "stale";

/** Buckets shown in the "needs attention" section, in priority order. */
export const ATTENTION_BUCKETS: Bucket[] = [
  "ci-failing",
  "has-conflicts",
  "needs-review",
  "ready-to-merge",
  "stale",
];

export function classifyPr(facts: PrFacts, now: Date, staleDays: number): Bucket[] {
  const buckets: Bucket[] = [];
  if (facts.draft) buckets.push("draft");
  if (facts.checksState === "failure") buckets.push("ci-failing");
  if (facts.mergeableState === "dirty") buckets.push("has-conflicts");
  if (facts.reviewState === "none" && !facts.draft) buckets.push("needs-review");
  if (
    facts.reviewState === "approved" &&
    facts.checksState === "success" &&
    (facts.mergeableState === "clean" || facts.mergeableState === "unstable")
  ) {
    buckets.push("ready-to-merge");
  }
  const updated = Date.parse(facts.updatedAt);
  if (!Number.isNaN(updated)) {
    const ageDays = (now.getTime() - updated) / 86_400_000;
    if (ageDays >= staleDays) buckets.push("stale");
  }
  return buckets;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @agenticos/github-plugin test -- classify`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/src/classify.ts packages/github-plugin/tests/classify.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): classifyPr pure bucket classifier

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: render — deterministic digest markdown

**Files:**
- Create: `packages/github-plugin/src/render.ts`
- Test: `packages/github-plugin/tests/render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/github-plugin/tests/render.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDigest, type AssessedPr } from "../src/render.js";

const NOW = new Date("2026-06-10T00:00:00Z");

const assessed: AssessedPr[] = [
  {
    repoFullName: "o/r", number: 1, title: "Broken", author: "a",
    htmlUrl: "u1", updatedAt: "2026-06-09T00:00:00Z",
    buckets: ["ci-failing", "needs-review"],
  },
  {
    repoFullName: "o/r", number: 2, title: "Done", author: "b",
    htmlUrl: "u2", updatedAt: "2026-06-09T00:00:00Z",
    buckets: ["ready-to-merge"],
  },
];

describe("renderDigest", () => {
  it("has a title, attention section, table, and front matter", () => {
    const md = renderDigest(assessed, NOW, []);
    expect(md).toContain("# Dev PR Triage");
    expect(md).toContain("generated_at:");
    expect(md).toContain("Needs your attention");
    expect(md).toContain("Broken");
    expect(md).toContain("Done");
    expect(md).toContain("o/r");
  });
  it("renders an errors footer when present", () => {
    const md = renderDigest([], NOW, ["o/x#3: boom"]);
    expect(md).toContain("Errors");
    expect(md).toContain("o/x#3: boom");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agenticos/github-plugin test -- render`
Expected: FAIL — cannot find `../src/render.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/github-plugin/src/render.ts`:

```ts
import { ATTENTION_BUCKETS, type Bucket } from "./classify.js";

export interface AssessedPr {
  repoFullName: string;
  number: number;
  title: string;
  author: string;
  htmlUrl: string;
  updatedAt: string;
  buckets: Bucket[];
}

function ageDays(updatedAt: string, now: Date): number {
  const t = Date.parse(updatedAt);
  return Number.isNaN(t) ? -1 : Math.floor((now.getTime() - t) / 86_400_000);
}

export function renderDigest(
  assessed: AssessedPr[],
  generatedAt: Date,
  errors: string[],
): string {
  const lines: string[] = [
    "---",
    `generated_at: ${generatedAt.toISOString()}`,
    "---",
    "",
    `# Dev PR Triage — ${generatedAt.toISOString().slice(0, 10)}`,
    "",
    "## 🔔 Needs your attention",
    "",
  ];

  const attention = assessed.filter((a) =>
    a.buckets.some((b) => ATTENTION_BUCKETS.includes(b)),
  );
  if (attention.length === 0) {
    lines.push("- Nothing flagged. 🎉");
  } else {
    const rank = (a: AssessedPr) => {
      for (let i = 0; i < ATTENTION_BUCKETS.length; i++) {
        if (a.buckets.includes(ATTENTION_BUCKETS[i]!)) return i;
      }
      return ATTENTION_BUCKETS.length;
    };
    for (const a of [...attention].sort((x, y) => rank(x) - rank(y))) {
      const tags = a.buckets.filter((b) => ATTENTION_BUCKETS.includes(b)).join(", ");
      lines.push(
        `- **[${a.repoFullName}#${a.number}](${a.htmlUrl})** ${a.title} — _${tags}_ (@${a.author})`,
      );
    }
  }

  lines.push("", "## All open PRs", "", "| Repo | PR | Author | Buckets | Age (d) |", "| --- | --- | --- | --- | --- |");
  for (const a of assessed) {
    const buckets = a.buckets.length ? a.buckets.join(", ") : "—";
    lines.push(
      `| ${a.repoFullName} | [#${a.number}](${a.htmlUrl}) | @${a.author} | ${buckets} | ${ageDays(a.updatedAt, generatedAt)} |`,
    );
  }

  if (errors.length) {
    lines.push("", "## ⚠️ Errors", "");
    for (const e of errors) lines.push(`- ${e}`);
  }
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @agenticos/github-plugin test -- render`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/src/render.ts packages/github-plugin/tests/render.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): renderDigest deterministic markdown

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: vault-writer — write the digest to vault-server

**Files:**
- Create: `packages/github-plugin/src/vault-writer.ts`
- Test: `packages/github-plugin/tests/vault-writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/github-plugin/tests/vault-writer.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { VaultWriter } from "../src/vault-writer.js";

afterEach(() => vi.restoreAllMocks());

describe("VaultWriter.writePage", () => {
  it("PUTs path + content to vault-server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ path: "wiki/_meta/dev-pr-digest.md" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const writer = new VaultWriter({ baseUrl: "http://vault-server:7777", timeoutMs: 5000 });
    const result = await writer.writePage("wiki/_meta/dev-pr-digest.md", "# hi\n");

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://vault-server:7777/page");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      path: "wiki/_meta/dev-pr-digest.md",
      content: "# hi\n",
    });
  });

  it("returns an error Result on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "nope" }) }));
    const writer = new VaultWriter({ baseUrl: "http://vault-server:7777", timeoutMs: 5000 });
    const result = await writer.writePage("wiki/_meta/x.md", "y");
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agenticos/github-plugin test -- vault-writer`
Expected: FAIL — cannot find `../src/vault-writer.js`.

- [ ] **Step 3: Write the implementation** (mirrors vault-client's request pattern)

Create `packages/github-plugin/src/vault-writer.ts`:

```ts
import type { Result } from "./github-client.js";

export interface VaultWriterConfig {
  baseUrl: string;
  timeoutMs: number;
}

export class VaultWriter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: VaultWriterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs;
  }

  async writePage(path: string, content: string): Promise<Result<{ path: string }>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/page`, {
        method: "PUT",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const json = (await res.json()) as { path?: string; error?: string };
      if (!res.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
      return { ok: true, data: { path: json.path ?? path } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "vault-server unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @agenticos/github-plugin test -- vault-writer`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add packages/github-plugin/src/vault-writer.ts packages/github-plugin/tests/vault-writer.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): VaultWriter.writePage (PUT /page client)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: worker — tools + the pr-triage job

**Files:**
- Create: `packages/github-plugin/src/job.ts` (the job body, testable in isolation)
- Create: `packages/github-plugin/src/worker.ts` (wires tools + registers the job)
- Test: `packages/github-plugin/tests/job.test.ts`

- [ ] **Step 1: Write the failing test** (the job orchestration, client + writer mocked)

Create `packages/github-plugin/tests/job.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runPrTriage } from "../src/job.js";

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    searchOpenPrs: vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          repoFullName: "o/r", number: 7, title: "T", author: "a",
          draft: false, updatedAt: "2026-06-09T00:00:00Z", htmlUrl: "u",
        },
      ],
    }),
    prDetail: vi.fn().mockResolvedValue({ ok: true, data: { mergeableState: "clean", headSha: "abc" } }),
    prChecksState: vi.fn().mockResolvedValue({ ok: true, data: "success" }),
    prReviewState: vi.fn().mockResolvedValue({ ok: true, data: "approved" }),
    ...overrides,
  };
}

describe("runPrTriage", () => {
  it("fetches, classifies, renders, and writes the digest", async () => {
    const writer = { writePage: vi.fn().mockResolvedValue({ ok: true, data: { path: "p" } }) };
    const summary = await runPrTriage({
      client: fakeClient() as any,
      writer: writer as any,
      now: new Date("2026-06-10T00:00:00Z"),
      staleDays: 7,
      vaultPath: "wiki/_meta/dev-pr-digest.md",
    });

    expect(summary.total).toBe(1);
    expect(summary.errored).toBe(0);
    expect(summary.buckets["ready-to-merge"]).toBe(1);
    expect(writer.writePage).toHaveBeenCalledOnce();
    const [, content] = writer.writePage.mock.calls[0];
    expect(content).toContain("ready-to-merge");
  });

  it("isolates a per-PR error without aborting the run", async () => {
    const client = fakeClient({
      prDetail: vi.fn().mockResolvedValue({ ok: false, error: "boom" }),
    });
    const writer = { writePage: vi.fn().mockResolvedValue({ ok: true, data: { path: "p" } }) };
    const summary = await runPrTriage({
      client: client as any, writer: writer as any,
      now: new Date("2026-06-10T00:00:00Z"), staleDays: 7,
      vaultPath: "wiki/_meta/dev-pr-digest.md",
    });
    expect(summary.errored).toBe(1);
    expect(writer.writePage).toHaveBeenCalledOnce(); // still writes the digest
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @agenticos/github-plugin test -- job`
Expected: FAIL — cannot find `../src/job.js`.

- [ ] **Step 3: Write the job body**

Create `packages/github-plugin/src/job.ts`:

```ts
import type { GitHubClient } from "./github-client.js";
import type { VaultWriter } from "./vault-writer.js";
import { classifyPr, type Bucket, type PrFacts } from "./classify.js";
import { renderDigest, type AssessedPr } from "./render.js";

export interface PrTriageDeps {
  client: GitHubClient;
  writer: VaultWriter;
  now: Date;
  staleDays: number;
  vaultPath: string;
}

export interface PrTriageSummary {
  total: number;
  errored: number;
  buckets: Record<string, number>;
  errors: string[];
}

export async function runPrTriage(deps: PrTriageDeps): Promise<PrTriageSummary> {
  const { client, writer, now, staleDays, vaultPath } = deps;
  const errors: string[] = [];

  const search = await client.searchOpenPrs();
  if (!search.ok) {
    throw new Error(`searchOpenPrs failed: ${search.error}`);
  }

  const assessed: AssessedPr[] = [];
  for (const pr of search.data) {
    try {
      const detail = await client.prDetail(pr.repoFullName, pr.number);
      if (!detail.ok) throw new Error(detail.error);
      const checks = await client.prChecksState(pr.repoFullName, detail.data.headSha);
      if (!checks.ok) throw new Error(checks.error);
      const review = await client.prReviewState(pr.repoFullName, pr.number);
      if (!review.ok) throw new Error(review.error);

      const facts: PrFacts = {
        ...pr,
        mergeableState: detail.data.mergeableState,
        checksState: checks.data,
        reviewState: review.data,
      };
      assessed.push({ ...pr, buckets: classifyPr(facts, now, staleDays) });
    } catch (err) {
      errors.push(`${pr.repoFullName}#${pr.number}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const buckets: Record<string, number> = {};
  for (const a of assessed) for (const b of a.buckets) buckets[b] = (buckets[b] ?? 0) + 1;

  const digest = renderDigest(assessed, now, errors);
  const write = await writer.writePage(vaultPath, digest);
  if (!write.ok) throw new Error(`vault write failed: ${write.error}`);

  return { total: assessed.length, errored: errors.length, buckets, errors };
}

// Re-export for the worker's convenience.
export type { Bucket };
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @agenticos/github-plugin test -- job`
Expected: PASS (both).

- [ ] **Step 5: Write the worker** (wires the SDK — no unit test; verified by typecheck + build)

Create `packages/github-plugin/src/worker.ts`:

```ts
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolResult } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { VaultWriter } from "./vault-writer.js";
import { runPrTriage } from "./job.js";

const ORG = process.env.GITHUB_ORG ?? "EngineeringMoonBear";
const STALE_DAYS = Number(process.env.PR_TRIAGE_STALE_DAYS ?? "7");
const VAULT_PATH = process.env.PR_TRIAGE_VAULT_PATH ?? "wiki/_meta/dev-pr-digest.md";

function ok(data: unknown): ToolResult {
  return { data };
}

const plugin = definePlugin({
  async setup(ctx) {
    const client = new GitHubClient({
      token: process.env.GITHUB_TOKEN ?? "",
      org: ORG,
      timeoutMs: 15000,
    });
    const writer = new VaultWriter({
      baseUrl: process.env.VAULT_SERVER_URL ?? "http://vault-server:7777",
      timeoutMs: 10000,
    });

    ctx.logger.info("GitHub plugin starting", { org: ORG });

    // --- Read-only tools (for on-demand Dev Agent use) ---

    ctx.tools.register(
      "github_list_prs",
      {
        displayName: "List Open PRs",
        description: "List all open PRs across the org",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => {
        const res = await client.searchOpenPrs();
        return res.ok ? ok(res.data) : { error: res.error };
      },
    );

    // --- Scheduled job: daily PR triage digest ---

    ctx.jobs.register("pr-triage", async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN not set; cannot reach GitHub");
      }
      const summary = await runPrTriage({
        client,
        writer,
        now: new Date(),
        staleDays: STALE_DAYS,
        vaultPath: VAULT_PATH,
      });
      ctx.logger.info("pr-triage complete", summary);
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
```

- [ ] **Step 6: Typecheck + build the worker**

Run: `pnpm --filter @agenticos/github-plugin typecheck && pnpm --filter @agenticos/github-plugin build`
Expected: typecheck clean; `dist/worker.js` produced.

> If `ctx.jobs.register`'s callback type complains about the unused `job` arg, accept it as `async () => {...}` (fewer params is allowed) — the SDK type is `(job: PluginJobContext) => Promise<void>`.

- [ ] **Step 7: Commit**

```bash
git add packages/github-plugin/src/job.ts packages/github-plugin/src/worker.ts packages/github-plugin/tests/job.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-plugin): pr-triage job + worker (tools + jobs.register)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] Full plugin suite + typecheck:

  Run: `pnpm --filter @agenticos/github-plugin test && pnpm --filter @agenticos/github-plugin typecheck`
  Expected: all PASS.

- [ ] Workspace typecheck stays green (no regressions):

  Run: `pnpm -w typecheck`
  Expected: all packages succeed (clear stale `apps/dashboard/.next/types` first if it errors locally — it is gitignored and regenerated in CI).

- [ ] vault-server suite green:

  Run: `pnpm --filter @agenticos/vault-server test`
  Expected: PASS.

- [ ] No placeholders: `grep -rn "TODO\|FIXME\|NotImplemented" packages/github-plugin/src` → no output.

- [ ] Open the PR; CI green (Lint, Typecheck, Unit tests, markdownlint, actionlint).

---

## Out of scope (deploy follow-ups, gated on the Paperclip runtime)

- Registering `@agenticos/github-plugin` into the running Paperclip instance and injecting `GITHUB_TOKEN` (Josh provisions a fine-grained read-only PAT) — part of the Paperclip migration's plugin-deploy step.
- Confirming the `pr-triage` job fires on Paperclip's heartbeat scheduler at 07:30 and writes the digest live.
- The agentic Dev Agent layer over these read-only tools (a later iteration).
