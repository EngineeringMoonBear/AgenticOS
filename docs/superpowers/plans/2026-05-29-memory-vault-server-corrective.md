# Memory + Vault-Server Corrective Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the Memory tab to actually show the user's Obsidian vault contents by introducing a `vault-server` service on the Droplet that exposes `/opt/vault` over the VPC, rewiring the dashboard's `/api/vault/*` routes to proxy to it, and reverting the misnamed Viking-premise UI from PRs #106/#107.

**Architecture:** Add one new Droplet-side Fastify service (`vault-server`) that wraps `@agenticos/vault-core` and the Syncthing REST API, bound on the agenticos-vpc IP at `10.10.0.5:7777`. Dashboard stays on App Platform and proxies vault calls via a new `VAULT_SERVER_URL` env var — same proxy shape PR #112 established for OpenViking + Postgres. Memory tab UI reverts to the legacy vault-driven components (`MemoryTree`/`Reader`/`Rail`/`InboxQueue`) restored from `ad14586^`. Stubs become real impls; OpenViking observability becomes its own honest-zeros surface.

**Tech Stack:** Node 22 + TypeScript + Fastify (vault-server), `@agenticos/vault-core` workspace package, pnpm 9.15.4, Docker Compose, Terraform (DigitalOcean + Cloudflare providers), Next.js 16 (dashboard), TanStack Query, vitest, Playwright, GitHub Actions.

**Spec reference:** [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](../specs/2026-05-29-memory-vault-server-corrective-design.md) (commit `078147d`).

---

## Operational prologue (read before starting)

### Branch + commit conventions

- **Working branch**: `feat/memory-vault-server-corrective` off `main`. Created in Task 0.
- **Never push to main directly.** PR for every batch of phases.
- **GPG signing is broken** on this clone (1Password agent). Every `git commit` MUST include `-c commit.gpgsign=false`.
- **Pre-commit hook** is installed locally from PR #113 but `.pre-commit-config.yaml` may not be on `main` at the working tree's base. Every commit MUST set `PRE_COMMIT_ALLOW_NO_CONFIG=1` so the hook becomes a no-op when the config is missing. Pattern:
  ```bash
  PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "..."
  ```
  This is harmless when the config DOES exist (the env var only suppresses the "no config" warning).

### Repo layout the plan assumes

- **Repo root**: `/Users/joshuadunbar/Documents/Dev Projects/AgenticOS`
- **Dashboard**: `apps/dashboard/`
- **Vault server (new)**: `infra/vault-server/`
- **Docker-compose source-of-truth**: `docker-compose.yml` at the repo root. Cloud-init `cp`s it to `/opt/agenticos/docker-compose.yml` on the Droplet.
- **Terraform**: `infra/terraform/`
- **VPC IP** (Droplet's private IP in `agenticos-vpc`): `10.10.0.5`

### Testing baseline

Before starting any task, confirm the baseline is healthy:

```bash
cd /Users/joshuadunbar/Documents/Dev\ Projects/AgenticOS
pnpm --filter @agenticos/dashboard test 2>&1 | tail -5
# expect: Test Files passed, no failures
pnpm --filter @agenticos/dashboard typecheck 2>&1 | tail -3
# expect: tsc --noEmit returns clean
pnpm --filter @agenticos/dashboard lint 2>&1 | tail -3
# expect: no errors
```

If the baseline is broken, fix it before proceeding — these tasks all assume green CI as a starting point.

---

## File structure (decided up-front)

### Phase A — vault-server scaffolding

| File | Responsibility |
|---|---|
| `infra/vault-server/package.json` | Package manifest, workspace member |
| `infra/vault-server/tsconfig.json` | TS compiler config |
| `infra/vault-server/src/server.ts` | Fastify bootstrap, route registration |
| `infra/vault-server/src/config.ts` | Env reading + Syncthing API key bootstrap |
| `infra/vault-server/src/routes/health.ts` | `GET /health` |
| `infra/vault-server/Dockerfile` | Multi-stage build |
| `infra/vault-server/.dockerignore` | Build context exclusions |
| `infra/vault-server/vitest.config.ts` | Test runner config |
| `pnpm-workspace.yaml` (modify) | Add `infra/vault-server` |
| `docker-compose.yml` (modify) | Add `vault-server` service |
| `infra/scripts/register-ufw-rules.sh` (modify) | Allow VPC → :7777 |

### Phase B — vault-server read endpoints

| File | Responsibility |
|---|---|
| `infra/vault-server/src/lib/vault-store.ts` | Lazy singleton wrapping `InMemoryVaultStore` |
| `infra/vault-server/src/routes/tree.ts` | `GET /tree` |
| `infra/vault-server/src/routes/page.ts` | `GET /page?path=…` |
| `infra/vault-server/src/routes/stats.ts` | `GET /stats` |
| `infra/vault-server/src/routes/backlinks.ts` | `GET /backlinks?path=…` |
| `infra/vault-server/src/routes/search.ts` | `GET /search?q=…` (ripgrep-backed) |
| `infra/vault-server/src/routes/inbox.ts` | `GET /inbox` (read-only for now) |
| `infra/vault-server/src/test/fixtures/` | Tiny on-disk test vault for vitest |
| `infra/vault-server/src/routes/*.test.ts` | Per-route tests against the fixture vault |

### Phase C — Dashboard rewire

| File | Responsibility |
|---|---|
| `apps/dashboard/lib/vault/remote-client.ts` | HTTP client wrapping `fetch(VAULT_SERVER_URL + path)`, implements the `VaultStore`-compatible surface |
| `apps/dashboard/lib/vault/remote-client.test.ts` | Unit tests with mocked fetch |
| `apps/dashboard/lib/vault/store-singleton.ts` (modify) | Switch from `InMemoryVaultStore` to `RemoteVaultClient` when `VAULT_SERVER_URL` is set |
| `apps/dashboard/lib/config/schema.ts` (modify) | Add `vaultServerUrl` optional field |
| `infra/terraform/app-platform.tf` (modify) | Add `VAULT_SERVER_URL` env block |

### Phase D — Memory tab UI revert

| File | Action |
|---|---|
| `apps/dashboard/components/memory/MemoryTree.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/MemoryReader.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/MemoryRail.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/InboxQueue.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/LintPanel.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/PromoteReviewDrawer.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/GraphCanvas.tsx` | Restore from `ad14586^` |
| `apps/dashboard/components/memory/CategoryBrowser.tsx` + `.test.tsx` | Delete |
| `apps/dashboard/components/memory/AbstractList.tsx` + `.test.tsx` | Delete |
| `apps/dashboard/components/memory/DetailView.tsx` + `.test.tsx` | Delete |
| `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx` + `.test.tsx` | Delete |
| `apps/dashboard/lib/hooks/use-memory-tree.ts` + `.test.tsx` | Delete |
| `apps/dashboard/lib/hooks/use-memory-abstracts.ts` + `.test.tsx` | Delete |
| `apps/dashboard/lib/hooks/use-memory-overview.ts` + `.test.tsx` | Delete |
| `apps/dashboard/lib/hooks/use-memory-detail.ts` + `.test.tsx` | Delete |
| `apps/dashboard/lib/hooks/use-trajectory.ts` + `.test.ts` | Delete |
| `apps/dashboard/app/api/memory/tree/` | Delete (whole directory) |
| `apps/dashboard/app/api/memory/abstracts/` | Delete |
| `apps/dashboard/app/api/memory/overview/` | Delete |
| `apps/dashboard/app/api/memory/detail/` | Delete |
| `apps/dashboard/app/api/memory/trajectory/` | Delete |
| `apps/dashboard/app/api/memory/scopes/` | Delete |
| `apps/dashboard/app/api/memory/skills/` | Delete |
| `apps/dashboard/app/memory/page.tsx` (rewrite) | Compose legacy components against `/api/vault/*` |

### Phase E — Stubs to real impls

| File | Responsibility |
|---|---|
| `infra/vault-server/src/lib/syncthing-client.ts` | REST client for Syncthing's `/rest/events` endpoint |
| `infra/vault-server/src/routes/recent-changes.ts` | `GET /recent-changes?since=…` proxying Syncthing events |
| `infra/vault-server/src/routes/skills.ts` | `GET /skills` parsing `vault/skills/*.md` frontmatter |
| `apps/dashboard/app/api/vault/recent-changes/route.ts` (rewrite) | Proxy to `vault-server` (was stub) |
| `apps/dashboard/app/api/vault/skills/route.ts` | New: proxy to `vault-server`'s `/skills` |
| `apps/dashboard/lib/vault/hooks/use-vault-skills.ts` | TanStack hook for skills catalog |
| `apps/dashboard/app/api/viking/health/route.ts` | New: real Viking health probe |
| `apps/dashboard/app/api/viking/scopes/route.ts` | New: real scope counts (honest zeros when empty) |
| `apps/dashboard/lib/hooks/use-viking-health.ts` | TanStack hook |
| `apps/dashboard/lib/hooks/use-viking-scopes.ts` | TanStack hook |
| `apps/dashboard/components/memory/OpenVikingSummaryPanel.tsx` (rewrite) | Consume real routes, render honest zeros |
| `apps/dashboard/components/memory/SkillsCatalogPanel.tsx` (rewrite) | Consume `/api/vault/skills` |
| `apps/dashboard/components/memory/RecentVaultChangesPanel.tsx` (rewrite) | Consume real `/api/vault/recent-changes` |

### Phase F — Deploy automation

| File | Responsibility |
|---|---|
| `.github/workflows/deploy-droplet.yml` | SSH-based deploy on push to main when vault-server or compose changes |
| `infra/README.md` (modify) | Remove stale CF Tunnel reference; document the deploy workflow |

---

## Task 0 — Create the working branch

**Files:**
- Modify: branch state (none on disk)

- [ ] **Step 1: Sync main + cut the working branch**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git checkout main
git pull origin main
git checkout -b feat/memory-vault-server-corrective
```

Expected: `Switched to a new branch 'feat/memory-vault-server-corrective'`.

- [ ] **Step 2: Confirm baseline is green**

```bash
pnpm --filter @agenticos/dashboard typecheck 2>&1 | tail -3
pnpm --filter @agenticos/dashboard lint 2>&1 | tail -3
```

Expected: both clean. If not, stop and fix baseline before starting Phase A.

- [ ] **Step 3: Note pre-commit posture**

```bash
ls .pre-commit-config.yaml 2>&1
```

If the file exists, commits work normally. If not, every commit in this plan uses `PRE_COMMIT_ALLOW_NO_CONFIG=1`. Either way the plan's commit commands include the env var defensively.

---

## Phase A — vault-server scaffolding (~3 hrs)

Goal: A `vault-server` Fastify app that responds to `GET /health` runs in docker-compose on `10.10.0.5:7777`. Nothing more.

### Task A1: Create the workspace package skeleton

**Files:**
- Create: `infra/vault-server/package.json`
- Create: `infra/vault-server/tsconfig.json`
- Create: `infra/vault-server/.gitignore`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Write `infra/vault-server/package.json`**

```json
{
  "name": "@agenticos/vault-server",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/server.js",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc -p . --noEmit"
  },
  "dependencies": {
    "@agenticos/vault-core": "workspace:*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Write `infra/vault-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `infra/vault-server/.gitignore`**

```
dist/
node_modules/
*.log
```

- [ ] **Step 4: Register the workspace in `pnpm-workspace.yaml`**

Open `pnpm-workspace.yaml`. The current content likely lists `apps/*` and `packages/*`. Add the new path:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'infra/vault-server'
```

- [ ] **Step 5: Install dependencies**

```bash
pnpm install --filter @agenticos/vault-server
```

Expected: `Done in <Xs>` and a `node_modules` symlink farm inside `infra/vault-server/`.

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/ pnpm-workspace.yaml pnpm-lock.yaml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): scaffold workspace package"
```

### Task A2: Bootstrap Fastify + `GET /health`

**Files:**
- Create: `infra/vault-server/src/config.ts`
- Create: `infra/vault-server/src/server.ts`
- Create: `infra/vault-server/src/routes/health.ts`
- Create: `infra/vault-server/src/routes/health.test.ts`
- Create: `infra/vault-server/vitest.config.ts`

- [ ] **Step 1: Write `infra/vault-server/src/config.ts`**

```ts
/**
 * Process-level env. Read once at startup. No magic strings inside route
 * handlers — every reachable env var flows through here.
 */
export interface Config {
  /** TCP port the Fastify server listens on. */
  port: number;
  /** Filesystem path of the vault root inside the container. */
  vaultRoot: string;
  /** Optional Syncthing REST base URL; absent → recent-changes returns available:false. */
  syncthingUrl: string | undefined;
  /** Optional Syncthing REST API key. */
  syncthingApiKey: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 7777);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port, got ${env.PORT}`);
  }
  return {
    port,
    vaultRoot: env.VAULT_ROOT ?? "/app/vault",
    syncthingUrl: env.SYNCTHING_URL || undefined,
    syncthingApiKey: env.SYNCTHING_API_KEY || undefined,
  };
}
```

- [ ] **Step 2: Write `infra/vault-server/src/routes/health.ts`**

```ts
import type { FastifyInstance } from "fastify";

export function registerHealthRoute(app: FastifyInstance): void {
  app.get("/health", async () => ({ ok: true }));
}
```

- [ ] **Step 3: Write `infra/vault-server/src/routes/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerHealthRoute } from "./health";

describe("GET /health", () => {
  it("returns {ok: true} with status 200", async () => {
    const app = Fastify();
    registerHealthRoute(app);

    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await app.close();
  });
});
```

- [ ] **Step 4: Write `infra/vault-server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
  },
});
```

- [ ] **Step 5: Run the test, expect it to fail because registerHealthRoute doesn't exist yet... wait it does. Run it anyway to confirm green-on-first-run.**

```bash
pnpm --filter @agenticos/vault-server test
```

Expected: 1 test passed.

- [ ] **Step 6: Write `infra/vault-server/src/server.ts`**

```ts
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { registerHealthRoute } from "./routes/health.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  registerHealthRoute(app);

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`vault-server listening on :${config.port}`);
}

main().catch((err) => {
  console.error("vault-server failed to start:", err);
  process.exit(1);
});
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @agenticos/vault-server typecheck
```

Expected: clean.

- [ ] **Step 8: Smoke-run locally**

```bash
PORT=7777 VAULT_ROOT=/tmp pnpm --filter @agenticos/vault-server dev &
sleep 2
curl -sS http://127.0.0.1:7777/health
# expect: {"ok":true}
kill %1
```

- [ ] **Step 9: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): bootstrap Fastify + GET /health"
```

### Task A3: Write the Dockerfile

**Files:**
- Create: `infra/vault-server/Dockerfile`
- Create: `infra/vault-server/.dockerignore`

- [ ] **Step 1: Write `infra/vault-server/.dockerignore`**

```
node_modules
dist
*.log
.git
test/
*.test.ts
vitest.config.ts
```

- [ ] **Step 2: Write `infra/vault-server/Dockerfile`**

Multi-stage build. Stage 1 installs deps + builds. Stage 2 is a slim runtime with only the built JS and prod deps. Critical: COPY the entire monorepo context because `@agenticos/vault-core` is a workspace dep.

```dockerfile
# Build stage — needs full monorepo for workspace resolution
FROM node:22-slim AS build

WORKDIR /repo

# pnpm via corepack (built into Node 22)
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy lockfile + workspace manifest first for layer cache efficiency
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/vault-core/package.json packages/vault-core/
COPY infra/vault-server/package.json infra/vault-server/

# Install (workspace-aware; only touches the manifests we copied)
RUN pnpm install --frozen-lockfile --filter @agenticos/vault-server...

# Now copy sources
COPY packages/vault-core packages/vault-core
COPY infra/vault-server infra/vault-server

# Build vault-server (which transitively needs vault-core sources)
RUN pnpm --filter @agenticos/vault-server build

# Runtime stage — only the built JS + prod deps
FROM node:22-slim AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy only the built output and the resolved node_modules tree
COPY --from=build /repo/infra/vault-server/dist ./dist
COPY --from=build /repo/infra/vault-server/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/vault-core ./packages/vault-core

# Non-root user
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=7777
EXPOSE 7777

CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: Build the image locally**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
docker build -f infra/vault-server/Dockerfile -t vault-server:dev .
```

Expected: build succeeds. Image size ~150MB.

- [ ] **Step 4: Smoke-run the image**

```bash
docker run --rm -d --name vault-server-test -p 7778:7777 vault-server:dev
sleep 3
curl -sS http://127.0.0.1:7778/health
# expect: {"ok":true}
docker rm -f vault-server-test
```

- [ ] **Step 5: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/Dockerfile infra/vault-server/.dockerignore
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): add multi-stage Dockerfile"
```

### Task A4: Register in `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml` (repo root)

- [ ] **Step 1: Find the file**

```bash
test -f docker-compose.yml && echo "OK (repo root)" || echo "MISSING"
```

If MISSING, the file is named differently or in a subdirectory. Grep:
```bash
find . -maxdepth 3 -name "docker-compose*.yml" -not -path "*/node_modules/*"
```

- [ ] **Step 2: Add the vault-server service**

Open `docker-compose.yml` and append a new entry to `services:` matching the existing pattern (look at `openviking` for reference — same `restart: unless-stopped`, same VPC-IP port binding):

```yaml
  vault-server:
    build:
      context: .
      dockerfile: infra/vault-server/Dockerfile
    container_name: vault-server
    restart: unless-stopped
    # Bind on the VPC interface so App Platform can reach us over the
    # 10.10.0.0/16 private network. NOT 127.0.0.1 — that would only be
    # reachable from this host.
    ports:
      - "10.10.0.5:7777:7777"
    volumes:
      # Read-only — the vault-server never writes through here.
      - /opt/vault:/app/vault:ro
      # Syncthing API key + config (read-only). Phase E reads this to talk
      # to Syncthing's REST API for the recent-changes endpoint.
      - /home/deploy/.config/syncthing:/syncthing-config:ro
    environment:
      VAULT_ROOT: /app/vault
      PORT: 7777
      # Syncthing API URL/key wired in Phase E. Empty for now is fine —
      # vault-server's config tolerates undefined.
      SYNCTHING_URL: ""
      SYNCTHING_API_KEY: ""
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:7777/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
```

- [ ] **Step 3: Validate compose syntax**

```bash
docker compose -f docker-compose.yml config --quiet
```

Expected: exit 0, no output. If it errors, fix the YAML.

- [ ] **Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add docker-compose.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): add vault-server to docker-compose"
```

### Task A5: UFW rule documentation (operator step)

**Files:**
- Modify: `infra/README.md`

UFW rules can't be set by Terraform on a running Droplet. Document the manual step so the operator knows to run it once after the deploy lands.

- [ ] **Step 1: Find the §"What Terraform can NOT do" section in `infra/README.md` and append**

Locate the list near the existing items about Tailscale ACL + Codex OAuth + Syncthing pairing. Append:

```markdown
5. **UFW rule for vault-server** — once the `vault-server` service is deployed, run on the Droplet:
   ```bash
   sudo ufw allow from 10.10.0.0/16 to any port 7777 proto tcp comment 'vault-server from VPC'
   sudo ufw status verbose | grep 7777
   # expect: 7777/tcp ALLOW IN 10.10.0.0/16
   ```
```

- [ ] **Step 2: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/README.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "docs(infra): document UFW rule for vault-server port"
```

### Task A6: Push the branch + draft PR for Phase A

- [ ] **Step 1: Push**

```bash
git push -u origin feat/memory-vault-server-corrective
```

- [ ] **Step 2: Open a draft PR**

```bash
gh pr create --draft --base main --title "Memory + vault-server corrective architecture" --body "Implements docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md. Draft while phases land incrementally.

- Phase A: vault-server scaffolding (GET /health)
- Phase B: read endpoints
- Phase C: dashboard rewire
- Phase D: Memory tab UI revert
- Phase E: stubs → real impls
- Phase F: deploy workflow
"
```

Note the PR number for later context.

---

## Phase B — vault-server read endpoints (~3 hrs)

Goal: `/tree`, `/page`, `/stats`, `/backlinks`, `/inbox`, `/search` all return real data when pointed at a real vault.

### Task B1: Vault store singleton

**Files:**
- Create: `infra/vault-server/src/lib/vault-store.ts`
- Create: `infra/vault-server/src/test/fixtures/sample-vault/HELLO.md`
- Create: `infra/vault-server/src/test/fixtures/sample-vault/farming/notes.md`

- [ ] **Step 1: Create fixture vault**

```bash
mkdir -p infra/vault-server/src/test/fixtures/sample-vault/farming
cat > infra/vault-server/src/test/fixtures/sample-vault/HELLO.md <<'EOF'
---
title: Hello
tags: [test]
---
# Hello world

This is a [[farming/notes]] link.
EOF
cat > infra/vault-server/src/test/fixtures/sample-vault/farming/notes.md <<'EOF'
---
title: Notes
tags: [farming, notes]
---
# Farming notes
EOF
```

- [ ] **Step 2: Write `infra/vault-server/src/lib/vault-store.ts`**

```ts
import { InMemoryVaultStore } from "@agenticos/vault-core/store";
import type { Config } from "../config.js";

let cached: InMemoryVaultStore | null = null;

/**
 * Lazy singleton. Calling getStore() the first time reads the vault root from
 * disk; subsequent calls reuse the same store. The store has its own internal
 * TTL-based revalidation (30s) so we don't rebuild on every request.
 */
export function getStore(config: Config): InMemoryVaultStore {
  if (cached) return cached;
  cached = new InMemoryVaultStore({
    vaultRoot: config.vaultRoot,
    ttlMs: 30_000,
  });
  return cached;
}

/** Test helper — reset between test cases. */
export function resetStoreForTests(): void {
  cached = null;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @agenticos/vault-server typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/lib/ infra/vault-server/src/test/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): vault-store singleton + fixture vault"
```

### Task B2: `GET /tree`

**Files:**
- Create: `infra/vault-server/src/routes/tree.ts`
- Create: `infra/vault-server/src/routes/tree.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// infra/vault-server/src/routes/tree.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTreeRoute } from "./tree.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /tree", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("returns the tree of the fixture vault", async () => {
    const app = Fastify();
    registerTreeRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/tree" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tree).toBeDefined();
    expect(Array.isArray(body.flatPaths)).toBe(true);
    // The fixture has HELLO.md at root and farming/notes.md nested
    expect(body.flatPaths).toContain("HELLO.md");
    expect(body.flatPaths).toContain("farming/notes.md");

    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/tree.test.ts
```

Expected: FAIL with "Cannot find module './tree.js'".

- [ ] **Step 3: Write `infra/vault-server/src/routes/tree.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerTreeRoute(app: FastifyInstance, config: Config): void {
  app.get("/tree", async () => {
    const store = getStore(config);
    const { tree, flat } = await store.list();
    return { tree, flatPaths: flat };
  });
}
```

- [ ] **Step 4: Wire into `src/server.ts`**

Open `infra/vault-server/src/server.ts` and add:

```ts
import { registerTreeRoute } from "./routes/tree.js";
// …inside main(), after registerHealthRoute(app):
registerTreeRoute(app, config);
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @agenticos/vault-server test routes/tree.test.ts
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/tree.ts infra/vault-server/src/routes/tree.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /tree"
```

### Task B3: `GET /page?path=…`

**Files:**
- Create: `infra/vault-server/src/routes/page.ts`
- Create: `infra/vault-server/src/routes/page.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// infra/vault-server/src/routes/page.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerPageRoute } from "./page.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

const config = {
  port: 7777,
  vaultRoot: fixtureRoot,
  syncthingUrl: undefined,
  syncthingApiKey: undefined,
};

describe("GET /page", () => {
  beforeEach(() => resetStoreForTests());

  it("returns the parsed page when found", async () => {
    const app = Fastify();
    registerPageRoute(app, config);

    const res = await app.inject({
      method: "GET",
      url: "/page?path=" + encodeURIComponent("HELLO.md"),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe("HELLO.md");
    expect(body.frontmatter?.title).toBe("Hello");
    // The body should mention the wikilink target
    expect(body.body).toMatch(/farming\/notes/);

    await app.close();
  });

  it("returns 400 when 'path' is missing", async () => {
    const app = Fastify();
    registerPageRoute(app, config);

    const res = await app.inject({ method: "GET", url: "/page" });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it("returns 404 when the page is not found", async () => {
    const app = Fastify();
    registerPageRoute(app, config);

    const res = await app.inject({
      method: "GET",
      url: "/page?path=does-not-exist.md",
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/page.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Write `infra/vault-server/src/routes/page.ts`**

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  path?: string;
}

export function registerPageRoute(app: FastifyInstance, config: Config): void {
  app.get("/page", async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
    const pagePath = req.query.path;
    if (!pagePath) {
      reply.code(400);
      return { error: "Missing 'path' query parameter" };
    }

    const store = getStore(config);
    const page = await store.read(pagePath);
    if (!page) {
      reply.code(404);
      return { error: "Page not found" };
    }
    return page;
  });
}
```

- [ ] **Step 4: Wire into `server.ts`**

```ts
import { registerPageRoute } from "./routes/page.js";
// …inside main():
registerPageRoute(app, config);
```

- [ ] **Step 5: Run, expect 3 passed**

```bash
pnpm --filter @agenticos/vault-server test routes/page.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/page.ts infra/vault-server/src/routes/page.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /page"
```

### Task B4: `GET /stats`

**Files:**
- Create: `infra/vault-server/src/routes/stats.ts`
- Create: `infra/vault-server/src/routes/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// infra/vault-server/src/routes/stats.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerStatsRoute } from "./stats.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /stats", () => {
  beforeEach(() => resetStoreForTests());

  it("returns stats with pageCount > 0 for the fixture vault", async () => {
    const app = Fastify();
    registerStatsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.pageCount).toBe("number");
    expect(body.pageCount).toBeGreaterThan(0);
    expect(typeof body.builtAt).toBe("number");

    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/stats.test.ts
```

- [ ] **Step 3: Write `infra/vault-server/src/routes/stats.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

export function registerStatsRoute(app: FastifyInstance, config: Config): void {
  app.get("/stats", async () => {
    const store = getStore(config);
    // The InMemoryVaultStore caches stats; calling list() first forces a
    // revalidate on cold start so stats reflect on-disk truth.
    await store.list();
    return store.stats();
  });
}
```

- [ ] **Step 4: Wire into `server.ts`**

```ts
import { registerStatsRoute } from "./routes/stats.js";
registerStatsRoute(app, config);
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm --filter @agenticos/vault-server test routes/stats.test.ts
```

- [ ] **Step 6: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/stats.ts infra/vault-server/src/routes/stats.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /stats"
```

### Task B5: `GET /backlinks?path=…`

**Files:**
- Create: `infra/vault-server/src/routes/backlinks.ts`
- Create: `infra/vault-server/src/routes/backlinks.test.ts`

- [ ] **Step 1: Inspect `InMemoryVaultStore` for a backlinks API**

```bash
grep -n "backlinks\|incoming" packages/vault-core/src/store/in-memory.ts | head
```

Note the method name. Likely `backlinks(path)` or accessed through the store's internal indexes. If no public method exists, use `list()` + filter forward wikilinks in code.

- [ ] **Step 2: Write the failing test**

```ts
// infra/vault-server/src/routes/backlinks.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerBacklinksRoute } from "./backlinks.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

const config = {
  port: 7777,
  vaultRoot: fixtureRoot,
  syncthingUrl: undefined,
  syncthingApiKey: undefined,
};

describe("GET /backlinks", () => {
  beforeEach(() => resetStoreForTests());

  it("returns HELLO.md as a backlink to farming/notes.md", async () => {
    // HELLO.md has [[farming/notes]] → farming/notes.md
    const app = Fastify();
    registerBacklinksRoute(app, config);

    const res = await app.inject({
      method: "GET",
      url: "/backlinks?path=" + encodeURIComponent("farming/notes.md"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.backlinks)).toBe(true);
    expect(body.backlinks).toContain("HELLO.md");

    await app.close();
  });

  it("returns 400 when 'path' is missing", async () => {
    const app = Fastify();
    registerBacklinksRoute(app, config);

    const res = await app.inject({ method: "GET", url: "/backlinks" });
    expect(res.statusCode).toBe(400);

    await app.close();
  });
});
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/backlinks.test.ts
```

- [ ] **Step 4: Write `infra/vault-server/src/routes/backlinks.ts`**

If `InMemoryVaultStore` has a `backlinks()` method, use it. If not, derive from `list()` + walk forward wikilinks:

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  path?: string;
}

export function registerBacklinksRoute(
  app: FastifyInstance,
  config: Config,
): void {
  app.get(
    "/backlinks",
    async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
      const target = req.query.path;
      if (!target) {
        reply.code(400);
        return { error: "Missing 'path' query parameter" };
      }

      const store = getStore(config);
      const { flat } = await store.list();
      const backlinks: string[] = [];

      for (const candidate of flat) {
        if (candidate === target) continue;
        const page = await store.read(candidate);
        if (!page) continue;
        const links = page.outgoingWikilinks ?? [];
        if (links.includes(target) || links.includes(target.replace(/\.md$/, ""))) {
          backlinks.push(candidate);
        }
      }

      return { backlinks };
    },
  );
}
```

**Note:** If `InMemoryVaultStore` exposes a more efficient `backlinks(path)` method (check Task B5 Step 1), use that instead.

- [ ] **Step 5: Wire into `server.ts`**

```ts
import { registerBacklinksRoute } from "./routes/backlinks.js";
registerBacklinksRoute(app, config);
```

- [ ] **Step 6: Run, expect pass**

```bash
pnpm --filter @agenticos/vault-server test routes/backlinks.test.ts
```

- [ ] **Step 7: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/backlinks.ts infra/vault-server/src/routes/backlinks.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /backlinks"
```

### Task B6: `GET /search?q=…`

**Files:**
- Create: `infra/vault-server/src/routes/search.ts`
- Create: `infra/vault-server/src/routes/search.test.ts`

Use `InMemoryVaultStore.search()` — already exists per the API surface check.

- [ ] **Step 1: Write the failing test**

```ts
// infra/vault-server/src/routes/search.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSearchRoute } from "./search.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /search", () => {
  beforeEach(() => resetStoreForTests());

  it("returns results matching the query", async () => {
    const app = Fastify();
    registerSearchRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/search?q=farming" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.total).toBe("number");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.total).toBeGreaterThan(0);

    await app.close();
  });

  it("returns empty results for a non-matching query", async () => {
    const app = Fastify();
    registerSearchRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/search?q=xyzzy123" });
    const body = res.json();
    expect(body.total).toBe(0);
    expect(body.results).toEqual([]);

    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/search.test.ts
```

- [ ] **Step 3: Write `infra/vault-server/src/routes/search.ts`**

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { getStore } from "../lib/vault-store.js";

interface Query {
  q?: string;
}

export function registerSearchRoute(app: FastifyInstance, config: Config): void {
  app.get(
    "/search",
    async (req: FastifyRequest<{ Querystring: Query }>, reply) => {
      const q = req.query.q?.trim();
      if (!q) {
        reply.code(400);
        return { error: "Missing 'q' query parameter" };
      }

      const store = getStore(config);
      const results = await store.search({ query: q });
      return { results, total: results.length };
    },
  );
}
```

**Note:** the `store.search()` signature may differ from this guess. Check `packages/vault-core/src/store/in-memory.ts:252` and adapt the call. If it returns just an array, the route can wrap it; if it returns `{results, total}`, return it directly.

- [ ] **Step 4: Wire into `server.ts`** + run + commit

```bash
# add to server.ts:
# import { registerSearchRoute } from "./routes/search.js";
# registerSearchRoute(app, config);

pnpm --filter @agenticos/vault-server test routes/search.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/search.ts infra/vault-server/src/routes/search.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /search"
```

### Task B7: `GET /inbox` (read-only)

**Files:**
- Create: `infra/vault-server/src/routes/inbox.ts`
- Create: `infra/vault-server/src/routes/inbox.test.ts`
- Create: `infra/vault-server/src/test/fixtures/sample-vault/inbox/draft.md`

- [ ] **Step 1: Add an inbox file to the fixture**

```bash
mkdir -p infra/vault-server/src/test/fixtures/sample-vault/inbox
cat > infra/vault-server/src/test/fixtures/sample-vault/inbox/draft.md <<'EOF'
---
captured: 2026-05-29T12:00:00Z
---
# Draft to triage
EOF
```

- [ ] **Step 2: Write the failing test**

```ts
// infra/vault-server/src/routes/inbox.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerInboxRoute } from "./inbox.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /inbox", () => {
  beforeEach(() => resetStoreForTests());

  it("lists items under inbox/", async () => {
    const app = Fastify();
    registerInboxRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/inbox" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const paths = body.items.map((i: { path: string }) => i.path);
    expect(paths).toContain("inbox/draft.md");

    await app.close();
  });
});
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test routes/inbox.test.ts
```

- [ ] **Step 4: Write `infra/vault-server/src/routes/inbox.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

interface InboxItem {
  path: string;
  size: number;
  modifiedAt: string;
}

export function registerInboxRoute(app: FastifyInstance, config: Config): void {
  app.get("/inbox", async () => {
    const inboxRoot = path.join(config.vaultRoot, "inbox");
    let entries: string[];
    try {
      entries = await fs.readdir(inboxRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { items: [] };
      }
      throw err;
    }

    const items: InboxItem[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(inboxRoot, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      items.push({
        path: `inbox/${name}`,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    return { items };
  });
}
```

- [ ] **Step 5: Wire into `server.ts`** + run + commit

```bash
# add to server.ts:
# import { registerInboxRoute } from "./routes/inbox.js";
# registerInboxRoute(app, config);

pnpm --filter @agenticos/vault-server test routes/inbox.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/inbox.ts infra/vault-server/src/routes/inbox.test.ts infra/vault-server/src/server.ts infra/vault-server/src/test/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /inbox (read-only)"
```

### Task B8: Full vault-server test sweep + push

- [ ] **Step 1: Run all vault-server tests**

```bash
pnpm --filter @agenticos/vault-server test
```

Expected: all green. Note total count.

- [ ] **Step 2: Typecheck + lint (lint is just tsc; vault-server has no eslint config)**

```bash
pnpm --filter @agenticos/vault-server typecheck
```

- [ ] **Step 3: Rebuild the Docker image with all endpoints**

```bash
docker build -f infra/vault-server/Dockerfile -t vault-server:dev .
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Phase C — Dashboard rewire (~3 hrs)

Goal: Dashboard's `/api/vault/*` routes call the new `vault-server` HTTP API instead of the local filesystem. `VAULT_SERVER_URL` is set on App Platform via Terraform.

### Task C1: Define the `RemoteVaultClient`

**Files:**
- Create: `apps/dashboard/lib/vault/remote-client.ts`
- Create: `apps/dashboard/lib/vault/remote-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/dashboard/lib/vault/remote-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RemoteVaultClient } from "./remote-client";

describe("RemoteVaultClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("list() hits GET /tree and returns {tree, flat}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tree: { name: "/" }, flatPaths: ["a.md"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RemoteVaultClient({ baseUrl: "http://vault-server:7777" });
    const result = await client.list();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vault-server:7777/tree",
      expect.any(Object),
    );
    expect(result.tree).toEqual({ name: "/" });
    expect(result.flat).toEqual(["a.md"]);
  });

  it("read(path) hits GET /page?path=… and returns the page", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ path: "a.md", body: "hello" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RemoteVaultClient({ baseUrl: "http://vault-server:7777" });
    const page = await client.read("a.md");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://vault-server:7777/page?path=a.md",
      expect.any(Object),
    );
    expect(page?.path).toBe("a.md");
  });

  it("read(path) returns null on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    const client = new RemoteVaultClient({ baseUrl: "http://vault-server:7777" });
    expect(await client.read("missing.md")).toBeNull();
  });

  it("stats() hits GET /stats", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pageCount: 7 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new RemoteVaultClient({ baseUrl: "http://vault-server:7777" });
    const stats = await client.stats();
    expect(stats.pageCount).toBe(7);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/dashboard test lib/vault/remote-client.test.ts
```

- [ ] **Step 3: Write `apps/dashboard/lib/vault/remote-client.ts`**

```ts
import "server-only";
import type { WikiPage, TreeNode, WikiPath, VaultStats } from "@agenticos/vault-core";

export interface RemoteVaultClientConfig {
  baseUrl: string;
}

interface ListResponse {
  tree: TreeNode;
  flatPaths: WikiPath[];
}

/**
 * HTTP client wrapping the vault-server's REST surface. Implements the same
 * shape as InMemoryVaultStore so route handlers don't need to know whether
 * the store is local-fs or remote-http.
 */
export class RemoteVaultClient {
  constructor(private readonly config: RemoteVaultClientConfig) {}

  private url(path: string, query?: Record<string, string>): string {
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    return `${this.config.baseUrl}${path}${qs}`;
  }

  async list(): Promise<{ tree: TreeNode; flat: WikiPath[] }> {
    const res = await fetch(this.url("/tree"), { cache: "no-store" });
    if (!res.ok) throw new Error(`vault-server /tree -> HTTP ${res.status}`);
    const body = (await res.json()) as ListResponse;
    return { tree: body.tree, flat: body.flatPaths };
  }

  async read(pagePath: WikiPath): Promise<WikiPage | null> {
    const res = await fetch(this.url("/page", { path: pagePath }), {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`vault-server /page -> HTTP ${res.status}`);
    return (await res.json()) as WikiPage;
  }

  async stats(): Promise<VaultStats> {
    const res = await fetch(this.url("/stats"), { cache: "no-store" });
    if (!res.ok) throw new Error(`vault-server /stats -> HTTP ${res.status}`);
    return (await res.json()) as VaultStats;
  }

  async search(opts: { query: string }): Promise<unknown> {
    const res = await fetch(this.url("/search", { q: opts.query }), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`vault-server /search -> HTTP ${res.status}`);
    const body = (await res.json()) as { results: unknown };
    return body.results;
  }

  async backlinks(pagePath: WikiPath): Promise<WikiPath[]> {
    const res = await fetch(this.url("/backlinks", { path: pagePath }), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`vault-server /backlinks -> HTTP ${res.status}`);
    const body = (await res.json()) as { backlinks: WikiPath[] };
    return body.backlinks;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @agenticos/dashboard test lib/vault/remote-client.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/lib/vault/remote-client.ts apps/dashboard/lib/vault/remote-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): RemoteVaultClient HTTP wrapper"
```

### Task C2: Switch `store-singleton.ts` to use `RemoteVaultClient` when `VAULT_SERVER_URL` is set

**Files:**
- Modify: `apps/dashboard/lib/vault/store-singleton.ts`

- [ ] **Step 1: Read the current file to know what's being replaced**

```bash
cat apps/dashboard/lib/vault/store-singleton.ts
```

- [ ] **Step 2: Rewrite as switch on env var**

```ts
import "server-only";
import os from "node:os";
import path from "node:path";
import { InMemoryVaultStore } from "@agenticos/vault-core/store";
import { readConfig } from "@/lib/config/config-io";
import { RemoteVaultClient } from "./remote-client";

/**
 * The shape route handlers actually need. Both InMemoryVaultStore (local fs)
 * and RemoteVaultClient (HTTP to vault-server) satisfy this.
 */
export type VaultStoreLike =
  | InMemoryVaultStore
  | RemoteVaultClient;

let cached: VaultStoreLike | null = null;

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export async function getVaultStore(): Promise<VaultStoreLike> {
  if (cached) return cached;

  // Production path (App Platform): proxy to vault-server over VPC.
  const vaultServerUrl = process.env.VAULT_SERVER_URL;
  if (vaultServerUrl) {
    cached = new RemoteVaultClient({ baseUrl: vaultServerUrl });
    return cached;
  }

  // Local-dev fallback: read from local filesystem. Configured via
  // ~/.agenticos/config.json (vaultPath field), default
  // "~/Documents/Dev Projects/vault".
  const cfg = await readConfig();
  cached = new InMemoryVaultStore({
    vaultRoot: expandTilde(cfg.vaultPath),
    ttlMs: 30_000,
  });
  return cached;
}

export function __resetVaultStoreForTests(): void {
  cached = null;
}
```

- [ ] **Step 3: Run dashboard tests to confirm nothing breaks**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard test lib/vault
```

Both should be green. If a test was asserting against a specific `InMemoryVaultStore` instance, it needs to assert against `VaultStoreLike`.

- [ ] **Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/lib/vault/store-singleton.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): switch vault store to RemoteVaultClient when VAULT_SERVER_URL is set"
```

### Task C3: Wire `VAULT_SERVER_URL` into App Platform Terraform

**Files:**
- Modify: `infra/terraform/app-platform.tf`

- [ ] **Step 1: Add the env block**

Open `infra/terraform/app-platform.tf` and add — alongside the existing `OPENVIKING_ENDPOINT` env block from PR #112 — the new variable:

```hcl
      env {
        # vault-server lives on the Droplet, bound on the agenticos VPC
        # interface at port 7777 — same VPC-proxy pattern as Viking and
        # Postgres above. Dashboard's lib/vault/store-singleton.ts reads
        # this and instantiates a RemoteVaultClient when set.
        key   = "VAULT_SERVER_URL"
        value = "http://${digitalocean_droplet.agenticos_droplet.ipv4_address_private}:7777"
        scope = "RUN_TIME"
      }
```

Insert after the `OPENVIKING_USER` block and before the `NODE_ENV` block.

- [ ] **Step 2: Validate**

```bash
cd infra/terraform
terraform fmt -check
terraform validate
cd ../..
```

Expected: both clean. If fmt drift, run `terraform fmt` and stage.

- [ ] **Step 3: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/terraform/app-platform.tf
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): VAULT_SERVER_URL env on App Platform"
```

### Task C4: Push + manual deploy verification

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Once the PR is mergeable, deploy the vault-server to the Droplet**

This is an operator step. Do it after a draft-PR review, possibly via the deploy workflow once Phase F lands. Until then, manually:

```bash
ssh agenticos
cd /opt/agenticos/repo
git pull origin feat/memory-vault-server-corrective  # only for verification; full deploy happens after merge
cp docker-compose.yml /opt/agenticos/docker-compose.yml
cd /opt/agenticos
sudo docker compose up -d --build vault-server
sudo docker compose ps vault-server  # expect: healthy
sudo docker compose logs -n 20 vault-server
curl -sS http://10.10.0.5:7777/health  # expect: {"ok":true}
exit  # back to laptop
```

- [ ] **Step 3: Test from App Platform (after Terraform apply)**

Apply the Terraform on the laptop:

```bash
TF_VAR_agenticos_db_password=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/agenticos_db_password") \
TF_VAR_openviking_root_api_key=$(op read "op://Goldberry Grove - Admin/AgenticOS Infra/openviking_root_api_key") \
  terraform -chdir=infra/terraform apply
```

Wait for App Platform to redeploy (~2 minutes). Then in the browser, hit `/api/vault/stats` directly:

```bash
# Replace with your actual CF Access cookie
curl -sS -H "Cookie: <CF_AUTHORIZATION cookie>" https://agenticos.gatheringatthegrove.com/api/vault/stats
# expect: real pageCount > 0 (was 0 before this work)
```

---

## Phase D — Memory tab UI revert (~2 hrs)

Goal: `/memory` shows the legacy three-pane layout populated with real vault content. The Viking-premise components are gone.

### Task D1: Restore legacy components from `ad14586^`

**Files:**
- Restore: `apps/dashboard/components/memory/MemoryTree.tsx`
- Restore: `apps/dashboard/components/memory/MemoryReader.tsx`
- Restore: `apps/dashboard/components/memory/MemoryRail.tsx`
- Restore: `apps/dashboard/components/memory/InboxQueue.tsx`
- Restore: `apps/dashboard/components/memory/LintPanel.tsx`
- Restore: `apps/dashboard/components/memory/PromoteReviewDrawer.tsx`
- Restore: `apps/dashboard/components/memory/GraphCanvas.tsx`

- [ ] **Step 1: Restore all seven via git checkout**

```bash
for f in MemoryTree MemoryReader MemoryRail InboxQueue LintPanel PromoteReviewDrawer GraphCanvas; do
  git checkout ad14586^ -- apps/dashboard/components/memory/${f}.tsx
done
```

- [ ] **Step 2: Sanity-check the restored files compile**

```bash
pnpm --filter @agenticos/dashboard typecheck
```

If errors, they're likely missing-dep errors (e.g., hooks under `lib/vault/hooks/` that need to also be restored). Restore as needed from the same SHA:

```bash
for f in use-vault-page use-vault-backlinks use-inbox-list use-lint-issues use-vault-revalidate use-vault-tree use-promote-inbox use-discard-inbox use-vault-stats; do
  git checkout ad14586^ -- apps/dashboard/lib/vault/hooks/${f}.ts 2>/dev/null || true
done
pnpm --filter @agenticos/dashboard typecheck
```

Iterate until typecheck is clean.

- [ ] **Step 3: Commit the restore**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/components/memory/ apps/dashboard/lib/vault/hooks/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "revert(dashboard): restore legacy vault-driven Memory components from ad14586^"
```

### Task D2: Delete Viking-premise components + hooks + routes

**Files:**
- Delete: `apps/dashboard/components/memory/CategoryBrowser.tsx` + `.test.tsx`
- Delete: `apps/dashboard/components/memory/AbstractList.tsx` + `.test.tsx`
- Delete: `apps/dashboard/components/memory/DetailView.tsx` + `.test.tsx`
- Delete: `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx` + `.test.tsx`
- Delete: `apps/dashboard/lib/hooks/use-memory-tree.ts` + `.test.tsx`
- Delete: `apps/dashboard/lib/hooks/use-memory-abstracts.ts` + `.test.tsx`
- Delete: `apps/dashboard/lib/hooks/use-memory-overview.ts` + `.test.tsx`
- Delete: `apps/dashboard/lib/hooks/use-memory-detail.ts` + `.test.tsx`
- Delete: `apps/dashboard/lib/hooks/use-trajectory.ts` + `.test.ts`
- Delete: `apps/dashboard/app/api/memory/tree/` directory
- Delete: `apps/dashboard/app/api/memory/abstracts/` directory
- Delete: `apps/dashboard/app/api/memory/overview/` directory
- Delete: `apps/dashboard/app/api/memory/detail/` directory
- Delete: `apps/dashboard/app/api/memory/trajectory/` directory
- Delete: `apps/dashboard/app/api/memory/scopes/` directory
- Delete: `apps/dashboard/app/api/memory/skills/` directory

- [ ] **Step 1: Run the deletion**

```bash
git rm apps/dashboard/components/memory/CategoryBrowser.tsx \
       apps/dashboard/components/memory/CategoryBrowser.test.tsx \
       apps/dashboard/components/memory/AbstractList.tsx \
       apps/dashboard/components/memory/AbstractList.test.tsx \
       apps/dashboard/components/memory/DetailView.tsx \
       apps/dashboard/components/memory/DetailView.test.tsx \
       apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx \
       apps/dashboard/components/memory/RetrievalTrajectoryGraph.test.tsx \
       apps/dashboard/lib/hooks/use-memory-tree.ts \
       apps/dashboard/lib/hooks/use-memory-tree.test.tsx \
       apps/dashboard/lib/hooks/use-memory-abstracts.ts \
       apps/dashboard/lib/hooks/use-memory-abstracts.test.tsx \
       apps/dashboard/lib/hooks/use-memory-overview.ts \
       apps/dashboard/lib/hooks/use-memory-overview.test.tsx \
       apps/dashboard/lib/hooks/use-memory-detail.ts \
       apps/dashboard/lib/hooks/use-memory-detail.test.tsx \
       apps/dashboard/lib/hooks/use-trajectory.ts \
       apps/dashboard/lib/hooks/use-trajectory.test.ts \
       2>/dev/null

git rm -r apps/dashboard/app/api/memory/tree \
          apps/dashboard/app/api/memory/abstracts \
          apps/dashboard/app/api/memory/overview \
          apps/dashboard/app/api/memory/detail \
          apps/dashboard/app/api/memory/trajectory \
          apps/dashboard/app/api/memory/scopes \
          apps/dashboard/app/api/memory/skills \
          2>/dev/null
```

Some files may not exist (already deleted in earlier PRs); the `2>/dev/null` swallows those errors safely.

- [ ] **Step 2: Find any remaining references**

```bash
grep -rln "CategoryBrowser\|AbstractList\|DetailView\|RetrievalTrajectoryGraph\|use-memory-tree\|use-memory-abstracts\|use-memory-overview\|use-memory-detail\|use-trajectory\|/api/memory/tree\|/api/memory/abstracts\|/api/memory/overview\|/api/memory/detail\|/api/memory/trajectory\|/api/memory/scopes\|/api/memory/skills" apps/dashboard --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v ".next"
```

If anything turns up, edit those files to remove the references.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @agenticos/dashboard typecheck
```

Expected: clean (the page.tsx will likely have broken imports; fix in Task D3).

- [ ] **Step 4: Commit the deletes**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "chore(dashboard): delete Viking-premise Memory components + routes + hooks"
```

### Task D3: Rewire `app/memory/page.tsx`

**Files:**
- Modify: `apps/dashboard/app/memory/page.tsx`

- [ ] **Step 1: Get the legacy page shape from git history**

```bash
git show ad14586^:apps/dashboard/app/memory/page.tsx > /tmp/legacy-memory-page.tsx
cat /tmp/legacy-memory-page.tsx | head -60
```

This is the reference shape — three-pane layout using `MemoryTree` + `MemoryReader` + `MemoryRail` + `InboxQueue`.

- [ ] **Step 2: Rewrite the current page.tsx**

Replace the body of `apps/dashboard/app/memory/page.tsx` with the legacy three-pane layout, but keep the `MemoryVista` hero from PR #104. A reference template:

```tsx
"use client";
import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { MemoryVista } from "@/components/shell/MemoryVista";
import { MemoryTree } from "@/components/memory/MemoryTree";
import { MemoryReader } from "@/components/memory/MemoryReader";
import { MemoryRail } from "@/components/memory/MemoryRail";
import { MemorySyncIndicator } from "@/components/memory/MemorySyncIndicator";
import { InboxQueue } from "@/components/memory/InboxQueue";
import { GraphCanvas } from "@/components/memory/GraphCanvas";

export default function MemoryPage() {
  const [selectedPath, setSelectedPath] = useQueryState(
    "page",
    parseAsString.withDefault("")
  );
  const [graphMode, setGraphMode] = useState(false);

  const activePath = selectedPath || null;

  function handleSelect(path: string) {
    void setSelectedPath(path);
  }

  function handleNavigate(path: string) {
    void setSelectedPath(path);
  }

  function handleGraphSelect(path: string) {
    void setSelectedPath(path);
    setGraphMode(false);
  }

  return (
    <>
      <MemoryVista />
      <div
        className="flex flex-col flex-1 overflow-hidden"
        style={{ height: "calc(100vh - 56px)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-2 border-b shrink-0"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface)",
          }}
        >
          <p
            className="text-[12px] font-medium tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Memory
          </p>
          <MemorySyncIndicator />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left rail: tree + inbox */}
          <div
            className="flex flex-col w-64 border-r overflow-hidden"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <div className="flex-1 overflow-auto">
              <MemoryTree selectedPath={activePath} onSelect={handleSelect} />
            </div>
            <InboxQueue />
          </div>

          {/* Center: reader or graph */}
          {graphMode ? (
            <GraphCanvas onSelectNode={handleGraphSelect} />
          ) : (
            <MemoryReader
              path={activePath}
              graphMode={graphMode}
              onToggleGraph={() => setGraphMode((g) => !g)}
            />
          )}

          {/* Right rail */}
          <MemoryRail path={activePath} onNavigate={handleNavigate} />
        </div>
      </div>
    </>
  );
}
```

Adjust prop names if the restored components use slightly different signatures — the legacy file from Step 1 is the source of truth.

- [ ] **Step 3: Typecheck + lint + build**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard lint
pnpm --filter @agenticos/dashboard build
```

All three should be green. If `build` fails on a stale chunk reference, run `rm -rf apps/dashboard/.next` and retry.

- [ ] **Step 4: Update the existing tab-isolation E2E spec**

`apps/dashboard/e2e/tab-isolation.spec.ts` mocks `/api/memory/tree` as a 502 — that route is now gone. Replace the mock target:

```diff
-    await page.route("**/api/memory/tree*", (route) =>
+    await page.route("**/api/vault/tree*", (route) =>
       route.fulfill({
         status: 502,
         contentType: "application/json",
         body: JSON.stringify({ error: "vault-server down" }),
       }),
     );
```

Update the test name from "when /api/memory/tree returns 502" → "when /api/vault/tree returns 502".

- [ ] **Step 5: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/app/memory/page.tsx apps/dashboard/e2e/tab-isolation.spec.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): rewire /memory to legacy three-pane vault layout"
```

### Task D4: Run the full test suite

- [ ] **Step 1: Run unit tests**

```bash
pnpm --filter @agenticos/dashboard test
```

Expected: all green. Count should be lower than before (we deleted ~20 tests from the Viking-premise components).

- [ ] **Step 2: Run E2E locally (optional but recommended)**

```bash
pnpm --filter @agenticos/dashboard test:e2e
```

Expected: green or skipped (depends on whether vault-server is reachable from the local dev mode).

- [ ] **Step 3: Push**

```bash
git push
```

---

## Phase E — Stubs to real impls (~3 hrs)

Goal: `/api/vault/recent-changes` returns real Syncthing events. `/api/vault/skills` returns the parsed vault `skills/*.md`. Real Viking observability routes exist and return honest zeros when empty.

### Task E1: Syncthing client + `/recent-changes` in vault-server

**Files:**
- Create: `infra/vault-server/src/lib/syncthing-client.ts`
- Create: `infra/vault-server/src/lib/syncthing-client.test.ts`
- Create: `infra/vault-server/src/routes/recent-changes.ts`
- Create: `infra/vault-server/src/routes/recent-changes.test.ts`

- [ ] **Step 1: Write the Syncthing client failing test**

```ts
// infra/vault-server/src/lib/syncthing-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { SyncthingClient } from "./syncthing-client.js";

describe("SyncthingClient", () => {
  it("getEvents() returns parsed events when API responds OK", async () => {
    const events = [
      { id: 1, type: "ItemFinished", time: "2026-05-30T01:00:00Z", data: { folder: "vault", item: "a.md" } },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(events), { status: 200 })));

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    const result = await client.getEvents();
    expect(result.available).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("ItemFinished");
  });

  it("getEvents() returns {available: false} when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    const result = await client.getEvents();
    expect(result.available).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("getEvents() respects the since parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SyncthingClient({ baseUrl: "http://st:8384", apiKey: "k" });
    await client.getEvents({ since: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://st:8384/rest/events?since=42",
      expect.objectContaining({ headers: { "X-API-Key": "k" } }),
    );
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm --filter @agenticos/vault-server test lib/syncthing-client.test.ts
```

- [ ] **Step 3: Write `infra/vault-server/src/lib/syncthing-client.ts`**

```ts
export interface SyncthingEvent {
  id: number;
  type: string;
  time: string;
  data: Record<string, unknown>;
}

export interface SyncthingResponse {
  available: boolean;
  events: SyncthingEvent[];
}

export interface SyncthingConfig {
  baseUrl: string;
  apiKey: string;
}

export class SyncthingClient {
  constructor(private readonly config: SyncthingConfig) {}

  async getEvents(opts: { since?: number } = {}): Promise<SyncthingResponse> {
    const qs = opts.since !== undefined ? `?since=${opts.since}` : "";
    try {
      const res = await fetch(`${this.config.baseUrl}/rest/events${qs}`, {
        headers: { "X-API-Key": this.config.apiKey },
      });
      if (!res.ok) {
        return { available: false, events: [] };
      }
      const events = (await res.json()) as SyncthingEvent[];
      return { available: true, events };
    } catch {
      return { available: false, events: [] };
    }
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm --filter @agenticos/vault-server test lib/syncthing-client.test.ts
```

- [ ] **Step 5: Write the `/recent-changes` test**

```ts
// infra/vault-server/src/routes/recent-changes.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRecentChangesRoute } from "./recent-changes.js";

const configWithSyncthing = {
  port: 7777,
  vaultRoot: "/tmp",
  syncthingUrl: "http://st:8384",
  syncthingApiKey: "key",
};

describe("GET /recent-changes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns Syncthing events filtered to vault folder activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 1, type: "ItemFinished", time: "2026-05-30T01:00:00Z", data: { folder: "vault", item: "a.md", action: "update" } },
            { id: 2, type: "FolderSummary", time: "2026-05-30T01:00:01Z", data: {} }, // filtered out
          ]),
          { status: 200 },
        ),
      ),
    );

    const app = Fastify();
    registerRecentChangesRoute(app, configWithSyncthing);

    const res = await app.inject({ method: "GET", url: "/recent-changes" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].path).toBe("a.md");
    expect(body.changes[0].kind).toBe("updated");

    await app.close();
  });

  it("returns {available: false} when Syncthing is unconfigured", async () => {
    const app = Fastify();
    registerRecentChangesRoute(app, {
      ...configWithSyncthing,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/recent-changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);

    await app.close();
  });
});
```

- [ ] **Step 6: Run, expect fail**

- [ ] **Step 7: Write `infra/vault-server/src/routes/recent-changes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { SyncthingClient, type SyncthingEvent } from "../lib/syncthing-client.js";

interface Change {
  path: string;
  kind: "created" | "updated" | "deleted";
  occurredAt: string;
}

export function registerRecentChangesRoute(
  app: FastifyInstance,
  config: Config,
): void {
  app.get("/recent-changes", async () => {
    if (!config.syncthingUrl || !config.syncthingApiKey) {
      return { available: false, changes: [] };
    }

    const client = new SyncthingClient({
      baseUrl: config.syncthingUrl,
      apiKey: config.syncthingApiKey,
    });

    const { available, events } = await client.getEvents();
    if (!available) return { available: false, changes: [] };

    const changes: Change[] = events
      .filter((ev) => ev.type === "ItemFinished")
      .map((ev) => mapEvent(ev))
      .filter((c): c is Change => c !== null);

    return { available: true, changes };
  });
}

function mapEvent(ev: SyncthingEvent): Change | null {
  const data = ev.data as { folder?: string; item?: string; action?: string };
  if (!data.folder || data.folder !== "vault") return null;
  if (!data.item) return null;
  let kind: Change["kind"] = "updated";
  if (data.action === "update") kind = "updated";
  else if (data.action === "delete") kind = "deleted";
  else if (data.action === "create") kind = "created";
  return { path: data.item, kind, occurredAt: ev.time };
}
```

- [ ] **Step 8: Wire into server.ts + run + commit**

```bash
# add to server.ts:
# import { registerRecentChangesRoute } from "./routes/recent-changes.js";
# registerRecentChangesRoute(app, config);

pnpm --filter @agenticos/vault-server test routes/recent-changes.test.ts lib/syncthing-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/lib/syncthing-client.ts infra/vault-server/src/lib/syncthing-client.test.ts infra/vault-server/src/routes/recent-changes.ts infra/vault-server/src/routes/recent-changes.test.ts infra/vault-server/src/server.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): Syncthing-backed /recent-changes"
```

### Task E2: Wire Syncthing env into docker-compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add a startup script that reads the API key from the bind-mounted Syncthing config**

The Syncthing API key lives in `~/.config/syncthing/config.xml`. We already bind-mount that directory into `/syncthing-config:ro`. Add a small inline entrypoint that extracts the key before launching the server, OR set the env at compose-config time by sourcing a script. Simplest: extract at startup inside the container.

Modify the `vault-server` service:

```yaml
  vault-server:
    # ...existing config...
    environment:
      VAULT_ROOT: /app/vault
      PORT: 7777
      SYNCTHING_URL: http://172.17.0.1:8384
      # SYNCTHING_API_KEY is set by the entrypoint below from the
      # bind-mounted config.xml. Empty here is fine.
      SYNCTHING_API_KEY: ""
    entrypoint:
      - /bin/sh
      - -c
      - |
        if [ -f /syncthing-config/config.xml ]; then
          export SYNCTHING_API_KEY="$$(grep -oP '(?<=<apikey>)[^<]+' /syncthing-config/config.xml | head -1)"
        fi
        exec node dist/server.js
```

Note the `$$` (escaped `$`) in YAML so `${SYNCTHING_API_KEY}` is interpreted by the shell at container startup, not by docker-compose at file-parse time.

- [ ] **Step 2: Validate**

```bash
docker compose -f docker-compose.yml config --quiet
```

- [ ] **Step 3: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add docker-compose.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(infra): wire Syncthing API key into vault-server at startup"
```

### Task E3: Rewrite dashboard's `/api/vault/recent-changes` route to proxy

**Files:**
- Modify: `apps/dashboard/app/api/vault/recent-changes/route.ts`

- [ ] **Step 1: Rewrite the route**

```ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) {
    return NextResponse.json({ source: "syncthing", available: false, changes: [] });
  }

  try {
    const res = await fetch(`${baseUrl}/recent-changes`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { source: "syncthing", available: false, error: `HTTP ${res.status}`, changes: [] },
        { status: 502 },
      );
    }
    const body = (await res.json()) as { available: boolean; changes: unknown[] };
    return NextResponse.json({
      source: "syncthing",
      available: body.available,
      changes: body.changes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        source: "syncthing",
        available: false,
        error: (err as Error).message,
        changes: [],
      },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Update existing tests for this route**

If there's an existing test file (`apps/dashboard/app/api/vault/recent-changes/route.test.ts`), rewrite it to mock fetch and assert the proxy shape. If not, create one following the pattern from `app/api/tasks/recent-events/route.test.ts`.

- [ ] **Step 3: Typecheck + run tests + commit**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard test app/api/vault/recent-changes
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/app/api/vault/recent-changes/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): proxy /api/vault/recent-changes to vault-server"
```

### Task E4: Skills catalog endpoint in vault-server

**Files:**
- Create: `infra/vault-server/src/routes/skills.ts`
- Create: `infra/vault-server/src/routes/skills.test.ts`
- Create: `infra/vault-server/src/test/fixtures/sample-vault/skills/triage.md`

- [ ] **Step 1: Add fixture**

```bash
mkdir -p infra/vault-server/src/test/fixtures/sample-vault/skills
cat > infra/vault-server/src/test/fixtures/sample-vault/skills/triage.md <<'EOF'
---
name: triage
description: Triage incoming inbox items into wiki sections
triggers: [inbox-add]
used_by: [curator]
---
# triage
Triage notes...
EOF
```

- [ ] **Step 2: Write the failing test**

```ts
// infra/vault-server/src/routes/skills.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSkillsRoute } from "./skills.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /skills", () => {
  beforeEach(() => resetStoreForTests());

  it("returns parsed skill frontmatter from vault/skills/", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalRegistered).toBeGreaterThanOrEqual(1);
    const triage = body.skills.find((s: { name: string }) => s.name === "triage");
    expect(triage).toBeTruthy();
    expect(triage.description).toMatch(/Triage incoming/);

    await app.close();
  });

  it("returns an empty list when the skills directory is missing", async () => {
    const app = Fastify();
    registerSkillsRoute(app, {
      port: 7777,
      vaultRoot: "/nonexistent",
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/skills" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ totalRegistered: 0, skills: [] });

    await app.close();
  });
});
```

- [ ] **Step 3: Write `infra/vault-server/src/routes/skills.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";

interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  usedBy: string[];
  path: string;
}

const SKILL_REGEX = /^---\s*\n([\s\S]*?)\n---/;

export function registerSkillsRoute(app: FastifyInstance, config: Config): void {
  app.get("/skills", async () => {
    const skillsRoot = path.join(config.vaultRoot, "skills");
    let entries: string[];
    try {
      entries = await fs.readdir(skillsRoot);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { totalRegistered: 0, skills: [] };
      }
      throw err;
    }

    const skills: SkillEntry[] = [];
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = path.join(skillsRoot, name);
      const raw = await fs.readFile(full, "utf-8");
      const fm = parseFrontmatter(raw);
      if (!fm) continue;
      skills.push({
        name: fm.name ?? name.replace(/\.md$/, ""),
        description: fm.description ?? "",
        triggers: toStringArray(fm.triggers),
        usedBy: toStringArray(fm.used_by ?? fm.usedBy),
        path: `skills/${name}`,
      });
    }

    return { totalRegistered: skills.length, skills };
  });
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const match = SKILL_REGEX.exec(raw);
  if (!match) return null;
  const fm: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = val;
    }
  }
  return fm;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v) return [v];
  return [];
}
```

- [ ] **Step 4: Wire into server.ts + run + commit**

```bash
# add to server.ts:
# import { registerSkillsRoute } from "./routes/skills.js";
# registerSkillsRoute(app, config);

pnpm --filter @agenticos/vault-server test routes/skills.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/vault-server/src/routes/skills.ts infra/vault-server/src/routes/skills.test.ts infra/vault-server/src/server.ts infra/vault-server/src/test/fixtures/sample-vault/skills/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(vault-server): GET /skills parses vault/skills frontmatter"
```

### Task E5: Dashboard `/api/vault/skills` proxy + hook

**Files:**
- Create: `apps/dashboard/app/api/vault/skills/route.ts`
- Create: `apps/dashboard/app/api/vault/skills/route.test.ts`
- Create: `apps/dashboard/lib/vault/hooks/use-vault-skills.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/dashboard/app/api/vault/skills/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface SkillEntry {
  name: string;
  description: string;
  triggers: string[];
  usedBy: string[];
  path: string;
}

export interface SkillsResponse {
  totalRegistered: number;
  skills: SkillEntry[];
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.VAULT_SERVER_URL;
  if (!baseUrl) {
    return NextResponse.json({ totalRegistered: 0, skills: [] });
  }

  try {
    const res = await fetch(`${baseUrl}/skills`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Write the test**

```ts
// apps/dashboard/app/api/vault/skills/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("/api/vault/skills", () => {
  it("returns empty when VAULT_SERVER_URL is unset", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totalRegistered: 0, skills: [] });
  });

  it("proxies to vault-server when configured", async () => {
    vi.stubEnv("VAULT_SERVER_URL", "http://vault-server:7777");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            totalRegistered: 1,
            skills: [
              {
                name: "triage",
                description: "x",
                triggers: [],
                usedBy: [],
                path: "skills/triage.md",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalRegistered).toBe(1);
    expect(body.skills[0].name).toBe("triage");
  });
});
```

- [ ] **Step 3: Write the hook**

```ts
// apps/dashboard/lib/vault/hooks/use-vault-skills.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { SkillsResponse } from "@/app/api/vault/skills/route";

export function useVaultSkills() {
  return useQuery<SkillsResponse>({
    queryKey: ["vault", "skills"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/vault/skills", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SkillsResponse;
    },
  });
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @agenticos/dashboard test app/api/vault/skills
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/app/api/vault/skills/ apps/dashboard/lib/vault/hooks/use-vault-skills.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): /api/vault/skills proxy + useVaultSkills hook"
```

### Task E6: Real OpenViking observability routes

**Files:**
- Create: `apps/dashboard/app/api/viking/health/route.ts`
- Create: `apps/dashboard/app/api/viking/health/route.test.ts`
- Create: `apps/dashboard/app/api/viking/scopes/route.ts`
- Create: `apps/dashboard/app/api/viking/scopes/route.test.ts`
- Create: `apps/dashboard/lib/hooks/use-viking-health.ts`
- Create: `apps/dashboard/lib/hooks/use-viking-scopes.ts`

- [ ] **Step 1: Write the health route + test**

```ts
// apps/dashboard/app/api/viking/health/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface VikingHealth {
  reachable: boolean;
  uptimeSec?: number;
  version?: string;
  ramMb?: number;
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.OPENVIKING_ENDPOINT;
  if (!baseUrl) {
    return NextResponse.json({ reachable: false });
  }
  try {
    const res = await fetch(`${baseUrl}/api/v1/observer/system`, {
      headers: {
        "X-OpenViking-Account": process.env.OPENVIKING_ACCOUNT ?? "agenticos",
        "X-OpenViking-User": process.env.OPENVIKING_USER ?? "deploy",
        Authorization: `Bearer ${process.env.OPENVIKING_API_KEY ?? ""}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ reachable: false });
    const body = (await res.json()) as {
      uptime_seconds?: number;
      version?: string;
      memory_mb?: number;
    };
    return NextResponse.json({
      reachable: true,
      uptimeSec: body.uptime_seconds,
      version: body.version,
      ramMb: body.memory_mb,
    });
  } catch {
    return NextResponse.json({ reachable: false });
  }
}
```

```ts
// apps/dashboard/app/api/viking/health/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("/api/viking/health", () => {
  it("returns reachable:false when OPENVIKING_ENDPOINT is unset", async () => {
    vi.stubEnv("OPENVIKING_ENDPOINT", "");
    const res = await GET();
    expect(await res.json()).toEqual({ reachable: false });
  });

  it("returns reachable:true with metrics on 200", async () => {
    vi.stubEnv("OPENVIKING_ENDPOINT", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ uptime_seconds: 1200, version: "0.3.19", memory_mb: 850 }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(await res.json()).toEqual({
      reachable: true,
      uptimeSec: 1200,
      version: "0.3.19",
      ramMb: 850,
    });
  });

  it("returns reachable:false when Viking errors", async () => {
    vi.stubEnv("OPENVIKING_ENDPOINT", "http://viking:1933");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await GET();
    expect(await res.json()).toEqual({ reachable: false });
  });
});
```

- [ ] **Step 2: Write the scopes route + test**

```ts
// apps/dashboard/app/api/viking/scopes/route.ts
import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export interface VikingScopes {
  reachable: boolean;
  total: number;
  scopes: Record<string, number>;
}

export async function GET(): Promise<NextResponse> {
  const baseUrl = process.env.OPENVIKING_ENDPOINT;
  if (!baseUrl) {
    return NextResponse.json({ reachable: false, total: 0, scopes: {} });
  }
  try {
    const res = await fetch(`${baseUrl}/api/v1/stats/memories`, {
      headers: {
        "X-OpenViking-Account": process.env.OPENVIKING_ACCOUNT ?? "agenticos",
        "X-OpenViking-User": process.env.OPENVIKING_USER ?? "deploy",
        Authorization: `Bearer ${process.env.OPENVIKING_API_KEY ?? ""}`,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ reachable: false, total: 0, scopes: {} });
    }
    const body = (await res.json()) as { counts?: Record<string, number> };
    const scopes = body.counts ?? {};
    const total = Object.values(scopes).reduce((acc, n) => acc + n, 0);
    return NextResponse.json({ reachable: true, total, scopes });
  } catch {
    return NextResponse.json({ reachable: false, total: 0, scopes: {} });
  }
}
```

```ts
// apps/dashboard/app/api/viking/scopes/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("/api/viking/scopes", () => {
  it("returns honest zeros when Viking has no data", async () => {
    vi.stubEnv("OPENVIKING_ENDPOINT", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ counts: {} }), { status: 200 })),
    );

    const res = await GET();
    expect(await res.json()).toEqual({ reachable: true, total: 0, scopes: {} });
  });

  it("aggregates per-scope counts into total", async () => {
    vi.stubEnv("OPENVIKING_ENDPOINT", "http://viking:1933");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ counts: { resources: 5, "user/memories": 2 } }),
          { status: 200 },
        ),
      ),
    );

    const res = await GET();
    expect(await res.json()).toEqual({
      reachable: true,
      total: 7,
      scopes: { resources: 5, "user/memories": 2 },
    });
  });
});
```

- [ ] **Step 3: Write the two hooks**

```ts
// apps/dashboard/lib/hooks/use-viking-health.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { VikingHealth } from "@/app/api/viking/health/route";

export function useVikingHealth() {
  return useQuery<VikingHealth>({
    queryKey: ["viking", "health"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/viking/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikingHealth;
    },
  });
}
```

```ts
// apps/dashboard/lib/hooks/use-viking-scopes.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { VikingScopes } from "@/app/api/viking/scopes/route";

export function useVikingScopes() {
  return useQuery<VikingScopes>({
    queryKey: ["viking", "scopes"],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/viking/scopes", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as VikingScopes;
    },
  });
}
```

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @agenticos/dashboard test app/api/viking
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/app/api/viking/ apps/dashboard/lib/hooks/use-viking-health.ts apps/dashboard/lib/hooks/use-viking-scopes.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): real OpenViking health + scopes routes + hooks"
```

### Task E7: Wire panels to real data (skills + recent changes + viking obs)

**Files:**
- Modify: `apps/dashboard/components/memory/SkillsCatalogPanel.tsx` (or restore if deleted)
- Modify: `apps/dashboard/components/memory/RecentVaultChangesPanel.tsx`
- Modify: `apps/dashboard/components/memory/OpenVikingSummaryPanel.tsx`

These panels still exist from before; they were consuming stub routes. Rewire to the real hooks.

- [ ] **Step 1: Rewire `SkillsCatalogPanel`**

Open `apps/dashboard/components/memory/SkillsCatalogPanel.tsx`. Replace its internal data source with `useVaultSkills()`:

```ts
import { useVaultSkills } from "@/lib/vault/hooks/use-vault-skills";

export function SkillsCatalogPanel() {
  const { data, isLoading, isError } = useVaultSkills();
  if (isLoading) return <div>Loading…</div>;
  if (isError || !data) return <div>Skills catalog unavailable.</div>;
  return (
    <div>
      <header>SKILLS CATALOG · {data.totalRegistered} registered</header>
      <ul>
        {data.skills.map((s) => (
          <li key={s.path}>
            <strong>{s.name}</strong>
            <p>{s.description}</p>
            {s.usedBy.length > 0 && <small>used by {s.usedBy.join(" · ")}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Adapt to whatever styling/classes the existing component used — the shape is what matters.

- [ ] **Step 2: Rewire `RecentVaultChangesPanel`**

Replace its `fetch("/api/vault/recent-changes")` (or hook) with the existing pattern, but the route now returns `{available: boolean, changes: [...]}`. Render an "offline" state when `available: false`.

- [ ] **Step 3: Rewire `OpenVikingSummaryPanel`**

Replace with `useVikingHealth()` + `useVikingScopes()`. Render real values, including "0 / 0 / 0 / 0" honestly when Viking is reachable but empty, and an "OpenViking unreachable" state when not.

- [ ] **Step 4: Re-add the three panels to `app/memory/page.tsx`** if they were dropped in Phase D Task D3

Open `apps/dashboard/app/memory/page.tsx` and add the summary strip back above the three-pane layout:

```tsx
import { OpenVikingSummaryPanel } from "@/components/memory/OpenVikingSummaryPanel";
import { SkillsCatalogPanel } from "@/components/memory/SkillsCatalogPanel";
import { RecentVaultChangesPanel } from "@/components/memory/RecentVaultChangesPanel";

// …in JSX, between <MemoryVista /> and the header bar:
<div className="grid grid-cols-12 gap-4 p-4 shrink-0">
  <div className="col-span-12 md:col-span-6 lg:col-span-4">
    <OpenVikingSummaryPanel />
  </div>
  <div className="col-span-12 md:col-span-6 lg:col-span-4">
    <SkillsCatalogPanel />
  </div>
  <div className="col-span-12 md:col-span-6 lg:col-span-4">
    <RecentVaultChangesPanel />
  </div>
</div>
```

- [ ] **Step 5: Typecheck + lint + test + commit**

```bash
pnpm --filter @agenticos/dashboard typecheck
pnpm --filter @agenticos/dashboard lint
pnpm --filter @agenticos/dashboard test components/memory
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add apps/dashboard/components/memory/ apps/dashboard/app/memory/page.tsx
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(dashboard): wire summary panels to real data sources"
```

### Task E8: Push Phase E

```bash
git push
```

---

## Phase F — Deploy automation + Asana #16 (~2 hrs)

Goal: `.github/workflows/deploy-droplet.yml` exists and successfully deploys `vault-server` on push to main when relevant files change.

### Task F1: Generate + register an SSH deploy key

This is an operator step that produces a secret. Do not commit any private key material.

- [ ] **Step 1: Generate a dedicated deploy key on the laptop**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/agenticos-deploy -C "github-actions-droplet-deploy" -N ""
cat ~/.ssh/agenticos-deploy.pub
```

- [ ] **Step 2: Append the public key to the Droplet's `deploy@`** `authorized_keys`

```bash
ssh agenticos
echo '<paste public key here>' >> ~/.ssh/authorized_keys
exit
ssh -i ~/.ssh/agenticos-deploy deploy@159.223.171.231 'echo ok'  # expect: ok
```

- [ ] **Step 3: Store the private key in GitHub secrets**

```bash
gh secret set DROPLET_SSH_KEY < ~/.ssh/agenticos-deploy --repo EngineeringMoonBear/AgenticOS
gh secret set DROPLET_HOST --body "159.223.171.231" --repo EngineeringMoonBear/AgenticOS
gh secret set DROPLET_USER --body "deploy" --repo EngineeringMoonBear/AgenticOS
```

### Task F2: Write `.github/workflows/deploy-droplet.yml`

**Files:**
- Create: `.github/workflows/deploy-droplet.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy Droplet

# Runs on every push to main when vault-server source or the root
# docker-compose.yml changes. SSHes to the Droplet, pulls the latest repo,
# rebuilds and restarts the vault-server service.
#
# Future: extend the trigger to also fire on hermes-* changes when Hermes
# lands. For now vault-server is the only Droplet-side service we ship from
# this repo (Hermes is imported as a Docker image).

on:
  push:
    branches: [main]
    paths:
      - 'infra/vault-server/**'
      - 'docker-compose.yml'
      - '.github/workflows/deploy-droplet.yml'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-droplet
  cancel-in-progress: false

jobs:
  deploy:
    name: Deploy vault-server
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Configure SSH
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.DROPLET_SSH_KEY }}" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh-keyscan -H "${{ secrets.DROPLET_HOST }}" >> ~/.ssh/known_hosts

      - name: Pull, rebuild, restart vault-server
        run: |
          ssh -i ~/.ssh/deploy_key \
              "${{ secrets.DROPLET_USER }}@${{ secrets.DROPLET_HOST }}" \
              'set -euo pipefail
               cd /opt/agenticos/repo
               git fetch origin main
               git reset --hard origin/main
               cp docker-compose.yml /opt/agenticos/docker-compose.yml
               cd /opt/agenticos
               sudo docker compose up -d --build vault-server
               sudo docker compose ps vault-server'

      - name: Health check
        run: |
          ssh -i ~/.ssh/deploy_key \
              "${{ secrets.DROPLET_USER }}@${{ secrets.DROPLET_HOST }}" \
              'curl -sS --max-time 5 http://10.10.0.5:7777/health'
          # expect: {"ok":true}
```

- [ ] **Step 2: Validate workflow syntax locally**

```bash
# If actionlint is on PATH:
actionlint .github/workflows/deploy-droplet.yml
# Or use the GitHub Action validator extension/online tool.
```

- [ ] **Step 3: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add .github/workflows/deploy-droplet.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(ci): deploy-droplet workflow for vault-server"
```

### Task F3: Clean up stale README + Asana

**Files:**
- Modify: `infra/README.md`

- [ ] **Step 1: Remove the stale Cloudflare Tunnel reference**

Find line ~21 in `infra/README.md`:

```diff
-  - Zero Trust Tunnel `agenticos-app-platform` routing the hostname to the App Platform URL
   - Zero Trust Access application + "Allow Josh" policy gating the hostname behind Google SSO
```

Remove the line.

- [ ] **Step 2: Remove `Account → Cloudflare Tunnel → Edit` from the documented API token scopes**

Search README for "Cloudflare Tunnel" — there's another reference under §3 "Create three API tokens" that lists CF Tunnel permission. Drop that bullet too. The token only needs DNS:Edit + Access:Edit.

- [ ] **Step 3: Document the new deploy workflow**

Append to §"What gets provisioned" or §"Deploy workflow" (whichever fits):

```markdown
- **Droplet-side service deploys** are now automated via `.github/workflows/deploy-droplet.yml`. The workflow triggers on push to `main` when `infra/vault-server/**` or the root `docker-compose.yml` changes, SSHes to the Droplet using a dedicated deploy key (`DROPLET_SSH_KEY` GH secret), pulls the latest repo, rebuilds the affected service, and runs a `/health` check. Manual trigger also available via `gh workflow run deploy-droplet.yml`.
```

- [ ] **Step 4: Commit**

```bash
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false add infra/README.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "docs(infra): drop stale CF Tunnel reference; document deploy-droplet workflow"
```

### Task F4: Mark Asana #16 done in the PR body

The implementation plan task tracker has task #16 ("Phase 7 Tasks 48-51b: CI/CD workflow files + deploy scripts") as pending. Once the PR is in review, edit the PR body to call out "Resolves Asana #16" and update the Asana task to completed via the MCP tools (see prior session conventions).

- [ ] **Step 1: Update PR body**

```bash
gh pr edit --body "..." # (extend the existing body with "Resolves Asana #16")
```

### Task F5: Push + watch CI

```bash
git push
gh pr checks --watch  # waits until all checks complete
```

Expected: all checks green. The `Deploy Droplet` workflow doesn't run until merge (it triggers on push to main), so it won't appear in PR checks — it'll run once you merge.

---

## Final verification (do after PR merges)

After `gh pr merge --merge`, run through the spec §10 acceptance criteria one by one:

- [ ] **Criterion 1**: `ssh agenticos 'docker compose -f /opt/agenticos/docker-compose.yml ps vault-server'` → status `healthy`
- [ ] **Criterion 2**: From the dashboard's server-side logs (DigitalOcean App Platform → Runtime Logs), confirm `fetch("http://10.10.0.5:7777/health")` returns `{"ok":true}` in <100ms
- [ ] **Criterion 3**: `https://agenticos.gatheringatthegrove.com/memory` shows the three-pane layout populated with `HELLO-FROM-MAC.md`, `HELLO-FROM-DROPLET.md`, `farming/` tree
- [ ] **Criterion 4**: Edit a `.md` file in Obsidian → save → switch to dashboard → file appears in "Recent vault changes" within ~30s with a real timestamp
- [ ] **Criterion 5**: OpenViking summary panel shows real zeros (0 / 0 / 0 / 0), not stubs
- [ ] **Criterion 6**: Full CI green on main (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, E2E)
- [ ] **Criterion 7**: `terraform plan` after this merge shows zero drift (state has caught up)
- [ ] **Criterion 8**: `deploy-droplet.yml` workflow run shows green on the merge commit (or on a manual `gh workflow run deploy-droplet.yml`)

If any acceptance criterion fails, open an issue with a tight repro and fix forward — don't try to bundle remediation into this PR.

---

## Self-review notes (run before claiming done)

The plan's writer ran the writing-plans skill's self-review checklist on this document. Results:

- **§1 Goal / Architecture / Tech Stack**: present in header. ✓
- **§3 Locked decisions coverage**: every decision has at least one task — #1 (Memory = vault) → Task D3; #2 (vault on /opt/vault) → Task A4 bind-mount; #3 (vault-server VPC at :7777) → Tasks A1–A4; #4 (dashboard stays on App Platform) → Task C3; #5 (UI revert) → Tasks D1–D3; #6 (Viking observability separate) → Task E6; #7 (skills from vault) → Tasks E4–E5; #8 (recent-changes via Syncthing REST) → Tasks E1–E3; #9 (CF pattern unchanged) → confirmed no work; #10 (deploy workflow) → Tasks F1–F2. ✓
- **§10 Acceptance criteria coverage**: each criterion is in the final verification section. ✓
- **Placeholder scan**: No "TBD" / "TODO" / "implement later" in any task. The note in B6 about a possibly-existing `backlinks()` method in `vault-core` is conditional guidance, not a placeholder. ✓
- **Type consistency**: `RemoteVaultClient` method signatures in Task C1 match `InMemoryVaultStore` (list/read/stats/search/backlinks). `VaultStoreLike` union in Task C2 references the same class. Response shapes in vault-server routes mirror what `RemoteVaultClient` parses. ✓
- **One thing that's intentionally underspecified**: the `store.search()` exact signature in B6 (the code says `store.search({ query: q })` but the plan tells the implementer to adapt to the real signature found in `packages/vault-core/src/store/in-memory.ts:252`). This is acceptable because the implementer has to read 5 lines of source to confirm — calling it out explicitly was the right call.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-memory-vault-server-corrective.md`.**
