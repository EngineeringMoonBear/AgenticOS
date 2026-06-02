# Inbox Write-Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator discard inbox captures from the dashboard (a reversible cloud write to `inbox/archived/`) and promote them via a human-applied Obsidian hand-off (zero cloud write to `wiki/`).

**Architecture:** vault-core gets a real archive-based `discardInbox`. vault-server exposes `POST /discard` + `GET /inbox/:path`. The dashboard proxies both and wires `RemoteVaultClient.discardInbox`/`readInbox`. Promote is client-side: the review drawer renders the drafted page + an `obsidian://` deep link (no server write). A nested `inbox`-only `rw` Docker mount makes `wiki/` physically unwritable by the cloud; Mac Syncthing flips to `sendreceive` so the archive move reaches Obsidian.

**Tech Stack:** Fastify (vault-server), Next.js App Router route handlers, TanStack Query, vitest, Docker Compose, Syncthing.

**Spec:** `docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`
**Branch:** `feat/inbox-write-surface` (already created off `origin/main`).

**Standing constraints:**
- Commits: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "…"`, message ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never push to main. Stay on `feat/inbox-write-surface`.
- **Do NOT stage the ~16 untracked WIP files** (KpiVista, CostBurnChip, MaxQuotaChip, EkgSweep, QueueDepthPanel, header.tsx, header-tabs.tsx, use-cost-burn/use-kpi-data/use-max-quota/use-memory-peer-rep/use-memory-sessions, app/api/memory/peer-rep, app/api/memory/sessions, app/api/tasks/queue-depth). `git add` only the exact files each task names.
- vault-server tests: `cd infra/vault-server && npx vitest run`. Dashboard tests: `cd apps/dashboard && npx vitest run <path>`. For typecheck, run targeted `timeout 120 npx tsc --noEmit` in the package dir (the machine is Node 25, repo pins Node 22, so full `pnpm typecheck`/`eslint` can hang) and rely on CI.
- TDD: failing test → run (fail) → implement → run (pass) → commit.

**Reconciliations honored:** `store.promoteInbox` stays UNUSED in remote mode (promotion is a client-side draft). The only `RemoteVaultClient` stubs this plan wires are `readInbox` + `discardInbox`; `getOutgoing`/`getAllTags`/`lint`/`revalidate` remain deferred (out of scope).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/vault-core/src/store/in-memory.ts` | `discardInbox` archives instead of deleting | 1 |
| `packages/vault-core/test/store/in-memory.test.ts` | archive behavior test | 1 |
| `infra/vault-server/src/routes/discard.ts` (+`.test.ts`) | `POST /discard` | 2 |
| `infra/vault-server/src/routes/inbox-read.ts` (+`.test.ts`) | `GET /inbox/:path` | 3 |
| `infra/vault-server/src/server.ts` | register both routes | 2,3 |
| `docker-compose.yml` | nested `inbox:rw` mount | 4 |
| `apps/dashboard/app/api/vault/discard/route.ts` (+test) | proxy `POST /discard` | 5 |
| `apps/dashboard/app/api/vault/inbox/[...path]/route.ts` (+test) | proxy `GET /inbox/:path` | 5 |
| `apps/dashboard/lib/vault/remote-client.ts` (+test) | real `discardInbox`/`readInbox` | 6 |
| `apps/dashboard/components/memory/PromoteReviewDrawer.tsx`, `InboxQueue.tsx`, hooks | client-side draft + deep link; wire discard | 7 |
| `vault/CLAUDE.md` (the vault repo, separate from this repo) | charter update | 8 (operator) |

---

## Task 1: `discardInbox` archives instead of deleting

**Why:** Charter says discard = move to `inbox/archived/`, never delete. Current impl `fs.unlink`s the file (`packages/vault-core/src/store/in-memory.ts:428-431`).

**Files:**
- Modify: `packages/vault-core/src/store/in-memory.ts:428-431`
- Test: `packages/vault-core/test/store/in-memory.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe("InMemoryVaultStore - ...")` area; follow the file's existing fixture helpers `writeInboxNote`, `inboxDir`):

```ts
describe("InMemoryVaultStore - discardInbox (archive, not delete)", () => {
  it("moves the inbox note into inbox/archived/ instead of deleting it", async () => {
    await writeInboxNote("toss.md", "# Toss\n\nfleeting");
    await store.discardInbox("toss.md");

    // original gone
    await expect(fs.access(path.join(inboxDir, "toss.md"))).rejects.toThrow();
    // archived copy exists with same content
    const archived = await fs.readFile(
      path.join(inboxDir, "archived", "toss.md"),
      "utf8",
    );
    expect(archived).toContain("fleeting");
  });

  it("disambiguates when an archived file of the same name already exists", async () => {
    await writeInboxNote("dup.md", "first");
    await store.discardInbox("dup.md");
    await writeInboxNote("dup.md", "second");
    await store.discardInbox("dup.md");

    const names = await fs.readdir(path.join(inboxDir, "archived"));
    expect(names.filter((n) => n.startsWith("dup")).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect fail**

`cd packages/vault-core && npx vitest run test/store/in-memory.test.ts -t "discardInbox"`
Expected: FAIL (current impl deletes; no `archived/` dir).

- [ ] **Step 3: Replace `discardInbox`** (`in-memory.ts:428-431`):

```ts
async discardInbox(inboxPath: InboxPath): Promise<void> {
  const abs = safeResolve(this.inboxDir, inboxPath);
  const archiveDir = path.join(this.inboxDir, "archived");
  await fs.mkdir(archiveDir, { recursive: true });

  const base = path.basename(abs);
  let dest = path.join(archiveDir, base);
  // Don't clobber an existing archived note of the same name.
  if (await pathExists(dest)) {
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    dest = path.join(archiveDir, `${stem}-${Date.now()}${ext}`);
  }
  await fs.rename(abs, dest);
}
```

Add this helper near the other module-level helpers (top of file, after imports):

```ts
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
```

> Note: `listInbox()` already lives at `vaultRoot/inbox/` and walks only that dir's files; confirm it does NOT recurse into `archived/` (so discarded items leave the queue). If `listInbox` recurses, exclude a top-level `archived/` dir there. Check `in-memory.ts` `listInbox`/`_walkInbox` before finishing.

- [ ] **Step 4: Run, expect pass** — `npx vitest run test/store/in-memory.test.ts -t "discardInbox"` → PASS. Then full `npx vitest run` in `packages/vault-core` (no regressions).

- [ ] **Step 5: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add packages/vault-core/src/store/in-memory.ts packages/vault-core/test/store/in-memory.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-core): discardInbox archives to inbox/archived (charter, not delete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: vault-server `POST /discard`

**Files:**
- Create: `infra/vault-server/src/routes/discard.ts`, `infra/vault-server/src/routes/discard.test.ts`
- Modify: `infra/vault-server/src/server.ts`

- [ ] **Step 1: Failing test** (`discard.test.ts`) — pattern from `infra/vault-server/src/routes/inbox.test.ts` + `resetStoreForTests`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerDiscardRoute } from "./discard.js";
import { resetStoreForTests } from "../lib/vault-store.js";

let tmp: string;
function cfg() {
  return { port: 7777, vaultRoot: tmp, wikiSubdir: "wiki", syncthingUrl: undefined, syncthingApiKey: undefined };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-discard-"));
  await fs.mkdir(path.join(tmp, "inbox"), { recursive: true });
  resetStoreForTests();
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("POST /discard", () => {
  it("archives the inbox note and returns 200", async () => {
    await fs.writeFile(path.join(tmp, "inbox", "x.md"), "# X\n\nbody", "utf8");
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: { inboxPath: "x.md" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().archivedPath).toContain("archived");
    await expect(fs.access(path.join(tmp, "inbox", "x.md"))).rejects.toThrow();
    await app.close();
  });

  it("400s on a path traversal attempt", async () => {
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: { inboxPath: "../escape.md" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400s when inboxPath is missing", async () => {
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail** — `cd infra/vault-server && npx vitest run src/routes/discard.test.ts`.

- [ ] **Step 3: Implement `discard.ts`** (mirror error handling of `page.ts`; `VaultPathError` from `@agenticos/vault-core` is thrown by `safeResolve` inside the store on traversal):

```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerDiscardRoute(app: FastifyInstance, config: Config): void {
  app.post("/discard", async (req, reply) => {
    const body = (req.body ?? {}) as { inboxPath?: unknown };
    if (typeof body.inboxPath !== "string" || body.inboxPath.length === 0) {
      return reply.code(400).send({ error: "inboxPath (string) is required" });
    }
    try {
      await getStore(config).discardInbox(body.inboxPath);
      return { archivedPath: `inbox/archived/${body.inboxPath}` };
    } catch (err) {
      // Path-traversal (VaultPathError) and ENOENT are client errors.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reply.code(404).send({ error: "inbox note not found" });
      if ((err as Error).name === "VaultPathError") return reply.code(400).send({ error: (err as Error).message });
      throw err;
    }
  });
}
```

> Confirm the exact thrown error name by reading `packages/vault-core/src/store/errors.ts` (it exports `VaultPathError`). If the class sets a different `.name`, match it. If `safeResolve` throws synchronously before the await, the try/catch still catches it.

- [ ] **Step 4: Register in `server.ts`** — add import + call alongside the others:

```ts
import { registerDiscardRoute } from "./routes/discard.js";
// ...after registerSkillsRoute(app, config):
registerDiscardRoute(app, config);
```

- [ ] **Step 5: Run, expect pass** — `npx vitest run src/routes/discard.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/discard.ts infra/vault-server/src/routes/discard.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): POST /discard archives an inbox note

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: vault-server `GET /inbox/:path`

**Why:** The promote drawer needs the capture body (`listInbox` omits it). This is a read.

**Files:**
- Create: `infra/vault-server/src/routes/inbox-read.ts`, `infra/vault-server/src/routes/inbox-read.test.ts`
- Modify: `infra/vault-server/src/server.ts`

- [ ] **Step 1: Failing test** (`inbox-read.test.ts`):

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerInboxReadRoute } from "./inbox-read.js";
import { resetStoreForTests } from "../lib/vault-store.js";

let tmp: string;
const cfg = () => ({ port: 7777, vaultRoot: tmp, wikiSubdir: "wiki", syncthingUrl: undefined, syncthingApiKey: undefined });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-inboxread-"));
  await fs.mkdir(path.join(tmp, "inbox"), { recursive: true });
  resetStoreForTests();
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("GET /inbox/:path", () => {
  it("returns the note body + title", async () => {
    await fs.writeFile(path.join(tmp, "inbox", "note.md"), "# Title\n\nhello body", "utf8");
    const app = Fastify();
    registerInboxReadRoute(app, cfg());
    const res = await app.inject({ method: "GET", url: "/inbox/note.md" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.title).toBe("Title");
    expect(b.body).toContain("hello body");
    await app.close();
  });

  it("404s for an unknown note", async () => {
    const app = Fastify();
    registerInboxReadRoute(app, cfg());
    const res = await app.inject({ method: "GET", url: "/inbox/missing.md" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement `inbox-read.ts`** — use a wildcard param so nested inbox paths work, and register it so it does NOT shadow the existing `GET /inbox` list route (different path depth, so both coexist):

```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerInboxReadRoute(app: FastifyInstance, config: Config): void {
  app.get<{ Params: { "*": string } }>("/inbox/*", async (req, reply) => {
    const inboxPath = req.params["*"];
    try {
      const note = await getStore(config).readInbox(inboxPath);
      if (!note) return reply.code(404).send({ error: "inbox note not found" });
      return note;
    } catch (err) {
      if ((err as Error).name === "VaultPathError") return reply.code(400).send({ error: (err as Error).message });
      throw err;
    }
  });
}
```

- [ ] **Step 4: Register in `server.ts`** (after the discard registration):

```ts
import { registerInboxReadRoute } from "./routes/inbox-read.js";
registerInboxReadRoute(app, config);
```

- [ ] **Step 5: Run, expect pass.** Then full `npx vitest run` in `infra/vault-server` (all green, no regression of the existing `/inbox` list test).

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/inbox-read.ts infra/vault-server/src/routes/inbox-read.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /inbox/* returns a single inbox note body

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: nested `inbox:rw` Docker mount

**Files:** Modify `docker-compose.yml` (vault-server `volumes:`).

- [ ] **Step 1: Edit the volumes block.** Current:

```yaml
    volumes:
      - /opt/vault:/app/vault:ro
      - /home/deploy/.local/state/syncthing:/syncthing-config:ro
```

Change to (add the nested rw override; the more-specific path wins for that subtree):

```yaml
    volumes:
      # Whole vault is read-only to the cloud…
      - /opt/vault:/app/vault:ro
      # …except the inbox quarantine, which vault-server may write (discard →
      # inbox/archived/). wiki/ and sources/ stay physically unwritable.
      - /opt/vault/inbox:/app/vault/inbox:rw
      - /home/deploy/.local/state/syncthing:/syncthing-config:ro
```

- [ ] **Step 2: Validate** — `docker compose config --quiet` → exit 0 (ignore unset-env warnings / missing `/opt/agenticos/.env` locally).

- [ ] **Step 3: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add docker-compose.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): nested inbox:rw mount — cloud can write only inbox/, never wiki/

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: dashboard proxy routes

**Files:**
- Create: `apps/dashboard/app/api/vault/discard/route.ts` (+ `route.test.ts`)
- Create: `apps/dashboard/app/api/vault/inbox/[...path]/route.ts` (+ `route.test.ts`)

> Pattern reference: read `apps/dashboard/app/api/vault/recent-changes/route.ts` (Phase E E3) for the `VAULT_SERVER_URL` proxy shape, `runtime = "nodejs"`, and error handling. Tests pattern: `apps/dashboard/app/api/vault/__tests__/`.

- [ ] **Step 1: `discard/route.ts`** — POST proxy:

```ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) return NextResponse.json({ error: "VAULT_SERVER_URL not set" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { inboxPath?: string };
  if (!body.inboxPath) return NextResponse.json({ error: "inboxPath required" }, { status: 400 });
  try {
    const res = await fetch(`${baseUrl}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inboxPath: body.inboxPath }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: `inbox/[...path]/route.ts`** — GET proxy (catch-all segment carries nested inbox paths):

```ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) return NextResponse.json({ error: "VAULT_SERVER_URL not set" }, { status: 503 });
  const { path } = await ctx.params;
  const inboxPath = path.map(encodeURIComponent).join("/");
  try {
    const res = await fetch(`${baseUrl}/inbox/${inboxPath}`, { cache: "no-store" });
    if (res.status === 404) return NextResponse.json({ error: "not found" }, { status: 404 });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
```

> **Verify the App-Router params shape** against this repo's Next version: read an existing dynamic route (e.g. search the repo for `params:` under `app/api`). Newer Next passes `params` as a Promise (as above); if this repo's routes use a sync `{ params: { path } }`, match that instead. Do NOT assume from training data — check a sibling route first.

- [ ] **Step 3: Tests** — mock `fetch`, assert: discard forwards `inboxPath` and propagates status; inbox-read joins the catch-all segments and returns the body / 404. Follow the existing `__tests__` style.

- [ ] **Step 4: Run** — `cd apps/dashboard && npx vitest run app/api/vault/discard app/api/vault/inbox` → PASS. `timeout 120 npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit** (add only these 4 files).

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/app/api/vault/discard apps/dashboard/app/api/vault/inbox
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): /api/vault/discard + /api/vault/inbox/[...path] proxies

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `RemoteVaultClient.discardInbox` + `readInbox`

**Files:**
- Modify: `apps/dashboard/lib/vault/remote-client.ts:137-151` (replace the two `notSupported` stubs)
- Test: `apps/dashboard/lib/vault/remote-client.test.ts` (add cases following the existing mocked-fetch pattern)

- [ ] **Step 1: Failing tests** (append to `remote-client.test.ts`):

```ts
describe("RemoteVaultClient.readInbox", () => {
  it("GETs /inbox/<path> and returns the note", async () => {
    const note = { path: "n.md", title: "N", capturedAt: "2026-06-01T00:00:00Z", body: "b" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(note), { status: 200 })));
    const c = new RemoteVaultClient({ baseUrl: "http://vs" });
    expect(await c.readInbox("n.md")).toEqual(note);
  });
  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const c = new RemoteVaultClient({ baseUrl: "http://vs" });
    expect(await c.readInbox("missing.md")).toBeNull();
  });
});

describe("RemoteVaultClient.discardInbox", () => {
  it("POSTs /discard with the inboxPath", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ archivedPath: "inbox/archived/n.md" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const c = new RemoteVaultClient({ baseUrl: "http://vs" });
    await c.discardInbox("n.md");
    expect(fetchMock).toHaveBeenCalledWith("http://vs/discard", expect.objectContaining({ method: "POST" }));
  });
  it("throws on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const c = new RemoteVaultClient({ baseUrl: "http://vs" });
    await expect(c.discardInbox("n.md")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect fail** (`npx vitest run lib/vault/remote-client.test.ts -t "readInbox|discardInbox"`).

- [ ] **Step 3: Replace the stubs** in `remote-client.ts` (the `readInbox` and `discardInbox` methods at lines ~137-151):

```ts
  async readInbox(inboxPath: InboxPath): Promise<InboxNote | null> {
    const segs = inboxPath.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${this.baseUrl}/inbox/${segs}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`vault-server /inbox/${inboxPath} -> HTTP ${res.status}`);
    return (await res.json()) as InboxNote;
  }
```

```ts
  async discardInbox(inboxPath: InboxPath): Promise<void> {
    const res = await fetch(`${this.baseUrl}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inboxPath }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`vault-server /discard -> HTTP ${res.status}`);
  }
```

Leave `promoteInbox`, `getOutgoing`, `getAllTags`, `lint`, `revalidate` as `notSupported` stubs (still deferred). Update the file's top doc comment to remove `readInbox`/`discardInbox` from the deferred list.

- [ ] **Step 4: Run, expect pass.** Full `npx vitest run lib/vault/remote-client.test.ts`. `timeout 120 npx tsc --noEmit`.

- [ ] **Step 5: Commit** (`remote-client.ts` + `.test.ts` only).

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/lib/vault/remote-client.ts apps/dashboard/lib/vault/remote-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): wire RemoteVaultClient.readInbox + discardInbox

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Promote drawer (client-side draft + deep link) & inbox wiring

> First **read** these files (they exist) before changing: `apps/dashboard/components/memory/InboxQueue.tsx`, `apps/dashboard/components/memory/PromoteReviewDrawer.tsx`, `apps/dashboard/lib/vault/hooks/use-promote-inbox.ts`, `use-discard-inbox.ts`, `use-inbox-list.ts`. The current `InboxQueue` calls `usePromoteInbox().mutate()` which hits a server promote — that path is being **removed** in favor of a client-side draft.

**Files:**
- Modify: `apps/dashboard/components/memory/InboxQueue.tsx`
- Rewrite: `apps/dashboard/components/memory/PromoteReviewDrawer.tsx`
- Modify: `apps/dashboard/lib/vault/hooks/use-discard-inbox.ts` (ensure it calls `POST /api/vault/discard` and invalidates the inbox-list query key on success)
- Remove server-promote usage from `use-promote-inbox.ts` (or delete the hook if now unused — confirm no other importers via `grep -r usePromoteInbox apps/dashboard`)
- Test: `apps/dashboard/components/memory/PromoteReviewDrawer.test.tsx`

- [ ] **Step 1: Failing test for the drawer** — render with a fixture note + selected category, assert it shows valid frontmatter+body and builds the deep link. Vault name in the link is `vault` (the Obsidian vault folder name = `~/Documents/Dev Projects/vault`, registered in Obsidian as `vault`):

```tsx
import { render, screen } from "@testing-library/react";
import { PromoteReviewDrawer } from "./PromoteReviewDrawer";

it("renders drafted frontmatter+body and an obsidian deep link", () => {
  render(
    <PromoteReviewDrawer
      inboxPath="capture.md"
      note={{ path: "capture.md", title: "Soil test", capturedAt: "2026-06-01T00:00:00Z", body: "pH was 6.2" }}
      onClose={() => {}}
    />,
  );
  // drafted markdown preview present
  expect(screen.getByText(/title: "Soil test"/)).toBeInTheDocument();
  expect(screen.getByText(/pH was 6.2/)).toBeInTheDocument();
  // deep link to the inbox note
  const link = screen.getByRole("link", { name: /open in obsidian/i }) as HTMLAnchorElement;
  expect(link.href).toContain("obsidian://open?vault=vault");
  expect(link.href).toContain("inbox/capture.md");
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Rewrite `PromoteReviewDrawer`** to be a pure client draft renderer. Props: `{ inboxPath: string; note: InboxNote; onClose: () => void }`. Behavior:
  - A `<select>` of target categories — derive from the wiki tree top-level folders (reuse the tree query the sidebar uses; or accept a `categories: string[]` prop the parent passes from its tree data). Default to the first category.
  - Editable title (default `note.title`) and tags (comma-separated input).
  - Compute `draft = renderFrontmatter({title, tags, created: today, updated: today}) + "\n\n" + note.body`. Implement `renderFrontmatter` inline in the drawer (mirror `buildFrontmatter` from `vault-core/src/store/in-memory.ts:442-457` — `title` JSON-quoted, `tags: [..]`, `created`/`updated` ISO date). Do NOT import the server-only store.
  - Render the `draft` in a `<pre>`; a **Copy** button (`navigator.clipboard.writeText(draft)`); an **Open in Obsidian** `<a href={obsidian://open?vault=vault&file=inbox/${encodeURIComponent(inboxPath)}}>`.
  - A short instruction line: "Create `wiki/<Category>/<name>.md` in Obsidian with this content, then Discard the inbox item."
  - No `useMutation`, no `/promote` fetch. The drawer never writes.

- [ ] **Step 4: Rewire `InboxQueue`:**
  - `handlePromote(note)` → `setDrawerNote(note)` after fetching its body via `readInbox` (use a `useQuery`/`useVaultInboxNote(inboxPath)` hook hitting `/api/vault/inbox/<path>`), then render `<PromoteReviewDrawer note={...} categories={...} onClose={...} />`. (Add a small `use-inbox-note.ts` hook mirroring the other vault hooks.)
  - `handleDiscard(note)` → `useDiscardInbox().mutate(note.path)`; on success the inbox-list query invalidates and the row disappears. Keep the existing disabled/spinner states.
  - Remove the `usePromoteInbox`/`PromoteResult` server path.

- [ ] **Step 5: Run drawer test + full memory component suite** — `cd apps/dashboard && npx vitest run components/memory` → PASS. `timeout 120 npx tsc --noEmit`.

- [ ] **Step 6: Commit** (only the memory components + the two/three hooks touched).

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/components/memory/InboxQueue.tsx apps/dashboard/components/memory/PromoteReviewDrawer.tsx apps/dashboard/components/memory/PromoteReviewDrawer.test.tsx apps/dashboard/lib/vault/hooks/use-discard-inbox.ts apps/dashboard/lib/vault/hooks/use-promote-inbox.ts apps/dashboard/lib/vault/hooks/use-inbox-note.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): promote = client-side draft + obsidian deep link; wire discard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: ship, deploy, verify (+ charter)

- [ ] **Step 1: Push + PR**

```bash
git push -u origin feat/inbox-write-surface
gh pr create --title "feat: inbox write-surface (discard + promote draft)" --body "Implements docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md. Discard archives (cloud write, inbox-only mount); promote drafts + obsidian deep link (no wiki write). Operator steps after merge: see PR comment."
```

- [ ] **Step 2: Watch CI** — `gh pr checks <n> --watch`. The spurious "CodeQL" meta-check may show red while "Analyze (javascript-typescript)" passes and code-scanning alerts = 0 (`gh api repos/EngineeringMoonBear/AgenticOS/code-scanning/alerts?ref=refs/heads/feat/inbox-write-surface&state=open`) — that is non-blocking (`mergeStateStatus: UNSTABLE`). Re-run Playwright once if it flakes (known).

- [ ] **Step 3: Merge** — `gh pr merge <n> --squash --delete-branch`. This changes `docker-compose.yml` + `infra/vault-server/**`, so `deploy-droplet.yml` auto-fires and rebuilds vault-server with the nested inbox-rw mount.

- [ ] **Step 4: Operator step — flip Mac Syncthing to sendreceive** (the user runs this; it reverses the protective sendonly set during the repoint, bounded to inbox by the mount):

```bash
CFG="$HOME/Library/Application Support/Syncthing/config.xml"
KEY=$(grep -oE '<apikey>[^<]*</apikey>' "$CFG" | sed -E 's|</?apikey>||g')
curl -s -X PATCH -H "X-API-Key: $KEY" \
  http://127.0.0.1:8384/rest/config/folders/agenticos-vault -d '{"type":"sendreceive"}' \
  -w "type set HTTP %{http_code}\n" -o /dev/null
```

- [ ] **Step 5: Verify deploy-droplet green** — `gh run list --workflow=deploy-droplet.yml --limit 1` → success on the merge SHA. Confirm container healthy: `ssh deploy@159.223.171.231 'docker compose -f /opt/agenticos/docker-compose.yml ps vault-server'`.

- [ ] **Step 6: Live verify round-trip** — discard an item from the dashboard Memory tab (or `curl -s -X POST http://10.116.16.2:7779/discard -H 'content-type: application/json' -d '{"inboxPath":"<some-inbox-note>.md"}'` on the Droplet), then confirm:
  - `ssh deploy@… 'ls /opt/vault/inbox/archived/'` shows the moved note.
  - It appears under `inbox/archived/` in the Mac Obsidian vault within ~30s (sendreceive round-trip).
  - Attempt a wiki write proves blocked: `ssh deploy@… 'docker compose -f /opt/agenticos/docker-compose.yml exec -T vault-server sh -c "touch /app/vault/wiki/_probe 2>&1 || echo BLOCKED-AS-EXPECTED"'` → `BLOCKED-AS-EXPECTED` (read-only mount). Remove the probe file if it somehow succeeded.

- [ ] **Step 7: Charter update (operator, in the VAULT repo not this one).** The vault `CLAUDE.md` lives in `~/Documents/Dev Projects/vault/CLAUDE.md` (a separate git repo). Edit the boundaries section to state: the `/memory` dashboard may **discard** (archive) inbox items via `/api/vault/discard` — the one sanctioned dashboard write; **promotion remains human-applied in Obsidian** (dashboard only drafts + deep-links); the cloud writes **only `inbox/`**. Commit in the vault repo. (Not part of this PR — different repo.)

---

## Final verification

- [ ] All vault-server + dashboard tests green in CI.
- [ ] `deploy-droplet` green on the merge commit; vault-server healthy.
- [ ] Discard round-trips dashboard → `inbox/archived/` → Obsidian.
- [ ] `wiki/` write is physically blocked (probe shows BLOCKED).
- [ ] Promote opens the drawer with valid draft + working `obsidian://` link; no cloud write occurs.
- [ ] `RemoteVaultClient.readInbox`/`discardInbox` no longer throw "deferred".
