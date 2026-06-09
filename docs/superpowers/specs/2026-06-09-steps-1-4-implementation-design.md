# Steps 1–4 Implementation Design — Docker Compose + DB + Plugins

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Parent spec:** [Paperclip integration design](./2026-06-09-paperclip-integration-design.md)
**Covers:** Migration steps 1–4 from §10 of the parent spec

---

## 1. Goal

Stand up the Paperclip runtime alongside the existing Hermes stack and deliver
the two core plugins (vault, OpenViking) so agents have access to both memory
brains. After this work, Paperclip is running, its schema is migrated, and the
two-brain memory model is wired — everything needed before theming, agent
creation, and adapter routing (steps 5+).

---

## 2. Step 1 — Fork + Docker Compose

### 2.1 Fork

Fork `paperclipai/paperclip` to `EngineeringMoonBear/paperclip` using:

```sh
gh repo fork paperclipai/paperclip --org EngineeringMoonBear --clone=false
```

Tag the current `master` HEAD as `agenticos-v0.1.0` for version pinning:

```sh
gh repo clone EngineeringMoonBear/paperclip /tmp/paperclip-pin
cd /tmp/paperclip-pin
git tag agenticos-v0.1.0
git push origin agenticos-v0.1.0
```

### 2.2 Droplet provisioning

Cloud-init (in `infra/terraform/droplet.tf`) clones the fork to
`/opt/paperclip` and checks out the pinned tag:

```sh
git clone --branch agenticos-v0.1.0 --depth 1 \
  https://github.com/EngineeringMoonBear/paperclip.git /opt/paperclip
```

### 2.3 Local development

For local dev, clone the fork into `vendor/paperclip` (gitignored):

```sh
# One-time setup
git clone --branch agenticos-v0.1.0 \
  https://github.com/EngineeringMoonBear/paperclip.git vendor/paperclip
```

Add `vendor/` to `.gitignore`.

A `docker-compose.override.yml` (gitignored, documented in README) points the
build context to `./vendor/paperclip` instead of `/opt/paperclip`.

### 2.4 Docker Compose service

Add to `docker-compose.yml`:

```yaml
paperclip-server:
  build:
    context: /opt/paperclip
    dockerfile: Dockerfile
  container_name: paperclip-server
  restart: unless-stopped
  ports:
    - "10.116.16.2:3100:3100"
  environment:
    HOST: "0.0.0.0"
    PORT: "3100"
    DATABASE_URL: postgresql://agenticos:${AGENTICOS_DB_PASSWORD}@agenticos-db:5432/agenticos
    PAPERCLIP_DEPLOYMENT_MODE: local_trusted
    PAPERCLIP_HOME: /paperclip
    SERVE_UI: "true"
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    OPENAI_API_KEY: ${OPENAI_API_KEY}
    OPENVIKING_ENDPOINT: http://openviking:1933
    OPENVIKING_ROOT_API_KEY: ${OPENVIKING_ROOT_API_KEY}
    OPENVIKING_ACCOUNT: agenticos
    OPENVIKING_USER: deploy
    VAULT_SERVER_URL: http://vault-server:7777
    TZ: America/New_York
  volumes:
    - paperclip-data:/paperclip
    - /opt/vault:/opt/vault:ro
    - ./packages/vault-plugin/dist:/paperclip/plugins/vault-plugin:ro
    - ./packages/openviking-plugin/dist:/paperclip/plugins/openviking-plugin:ro
  env_file:
    - /opt/agenticos/.env
  depends_on:
    agenticos-db:
      condition: service_healthy
    ollama:
      condition: service_healthy
    openviking:
      condition: service_healthy
    vault-server:
      condition: service_healthy
  healthcheck:
    test:
      - CMD
      - node
      - -e
      - "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
    interval: 10s
    timeout: 5s
    retries: 10
    start_period: 90s
```

Add `paperclip-data:` to the top-level `volumes:` section.

### 2.5 New secrets

Add to `infra/scripts/setup-secrets-1password.sh`:

```sh
ANTHROPIC_API_KEY="$(op read 'op://Goldberry Grove - Admin/anthropic-api-key/credential')"
DEEPSEEK_API_KEY="$(op read 'op://Goldberry Grove - Admin/deepseek-api-key/credential')"
```

`OPENAI_API_KEY` and `OPENVIKING_ROOT_API_KEY` already exist in the `.env`.

---

## 3. Step 2 — Database Migration

**No manual migration step.** Paperclip's server runs Drizzle ORM migrations
automatically on startup. When `paperclip-server` boots and connects to the
`agenticos` database, it:

1. Checks `drizzle_migrations` table for applied migrations
2. Applies all pending migration SQL files (80+ tables)
3. Starts serving

The Paperclip tables (`companies`, `agents`, `heartbeats`, `issues`,
`cost_events`, `company_skills`, `company_memberships`, etc.) coexist with the
legacy Hermes tables (`tasks`, `sessions`, `calls`). No name collisions — the
Hermes schema uses generic names that Paperclip doesn't reuse.

**Verification:** After first boot, confirm with:

```sh
docker exec agenticos-db psql -U agenticos -d agenticos \
  -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" \
  | grep -c ''
```

Should show 80+ more tables than before.

---

## 4. Step 3 — Vault Plugin (`@agenticos/vault-plugin`)

### 4.1 Package setup

```
packages/vault-plugin/
  package.json
  tsconfig.json
  src/
    manifest.ts
    worker.ts
    vault-client.ts
    tools/
      search.ts
      read.ts
      list.ts
      stats.ts
    actions/
      discard.ts
    jobs/
      inbox-monitor.ts
      skills-sync.ts
      taxonomy-sync.ts
  tests/
    vault-client.test.ts
    tools.test.ts
```

`package.json`:
```json
{
  "name": "@agenticos/vault-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/worker.js",
  "scripts": {
    "build": "esbuild src/worker.ts --bundle --platform=node --format=esm --outfile=dist/worker.js",
    "dev": "esbuild src/worker.ts --bundle --platform=node --format=esm --outfile=dist/worker.js --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@paperclipai/plugin-sdk": "latest"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

### 4.2 Manifest

```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.vault-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Vault",
  description: "Obsidian vault integration — read-only knowledge access + inbox archival",
  author: "AgenticOS",
  categories: ["knowledge", "integration"],
  capabilities: ["projects.managed"],
  entrypoints: { worker: "./dist/worker.js" },
};

export default manifest;
```

### 4.3 Vault HTTP client

```ts
interface VaultClientConfig {
  baseUrl: string;   // default: http://vault-server:7777
  timeoutMs: number; // default: 5000
}
```

Methods:

| Method | HTTP | Vault-server endpoint |
|---|---|---|
| `search(query: string)` | `GET /search?q=...` | Full-text search |
| `getPage(path: string)` | `GET /pages/:path` | Read single page |
| `listPages(opts?)` | `GET /pages` | List with optional tag/folder filter |
| `getStats()` | `GET /stats` | Page count, categories |
| `getInbox()` | `GET /inbox` | List inbox items |
| `discardInboxItem(path: string)` | `POST /discard` | Archive inbox → inbox/archived/ |

All methods return `{ ok: true, data }` or `{ ok: false, error }` — never throw.
Vault-server unreachable → `{ ok: false, error: "vault-server unreachable" }`.

### 4.4 Tools

Each tool is registered in the worker's `setup(ctx)`:

**`vault_search`** — agents search the human knowledge base:
- Input: `{ query: string, limit?: number }`
- Calls `vaultClient.search(query)`
- Returns: array of `{ path, title, snippet, score }`

**`vault_read`** — agents read a specific wiki page:
- Input: `{ path: string }`
- Calls `vaultClient.getPage(path)`
- Returns: `{ path, title, content, frontmatter, tags }`

**`vault_list`** — agents browse the vault structure:
- Input: `{ folder?: string, tag?: string }`
- Calls `vaultClient.listPages({ folder, tag })`
- Returns: array of `{ path, title, tags }`

**`vault_stats`** — agents check vault health:
- Input: `{}`
- Calls `vaultClient.getStats()`
- Returns: `{ pageCount, categories, lastModified }`

### 4.5 Actions

**`vault_discard`** — archive an inbox item (the ONLY write path):
- Input: `{ path: string }` (must be under `inbox/`)
- Calls `vaultClient.discardInboxItem(path)`
- Returns: `{ archived: true, from, to }`
- Rejects paths not under `inbox/` client-side before calling vault-server

### 4.6 Jobs

**`inbox-monitor`** — periodic poll for new inbox items:
- Calls `vaultClient.getInbox()`
- Compares against last-known list (stored in plugin state via `ctx.state`)
- New items → log notification via `ctx.logger.info`

**`skills-sync`** — sync vault skills to Paperclip:
- Reads `wiki/Skills/` pages from vault-server
- Parses each page's frontmatter for skill metadata
- Upserts to `company_skills` via `ctx.db` or Paperclip API
- One-way: vault → Paperclip (never writes back)

**`taxonomy-sync`** — sync vault folder structure as labels:
- Reads folder tree from vault-server
- Upserts top-level categories as Paperclip labels/tags

### 4.7 Governance invariants (preserved)

- Plugin communicates with vault-server HTTP only — never touches `/opt/vault`
- vault-server mounts `wiki/` and `sources/` read-only (`:ro` in Docker)
- Only write: `discard` (inbox → inbox/archived/), reversible
- No auto-promotion — human-applied in Obsidian
- No three-pane Memory tab rebuild — read-only reference only

---

## 5. Step 4 — OpenViking Plugin (`@agenticos/openviking-plugin`)

### 5.1 Package setup

```
packages/openviking-plugin/
  package.json
  tsconfig.json
  src/
    manifest.ts
    worker.ts
    viking-client.ts
    tools/
      remember.ts
      recall.ts
      find.ts
      abstract.ts
    data/
      memory-stats.ts
  tests/
    viking-client.test.ts
    tools.test.ts
```

Same `package.json` pattern as vault-plugin, name `@agenticos/openviking-plugin`.

### 5.2 Manifest

```ts
import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.openviking-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenViking Memory",
  description: "Agent semantic memory — remember, recall, find, and abstract",
  author: "AgenticOS",
  categories: ["memory", "integration"],
  capabilities: [],
  entrypoints: { worker: "./dist/worker.js" },
};

export default manifest;
```

### 5.3 OpenViking HTTP client

```ts
interface VikingClientConfig {
  baseUrl: string;        // default: http://openviking:1933
  apiKey: string;         // OPENVIKING_ROOT_API_KEY
  account: string;        // default: agenticos
  user: string;           // default: deploy
  readTimeoutMs: number;  // default: 5000
  writeTimeoutMs: number; // default: 10000
}
```

Auth header: `Authorization: Bearer <apiKey>` on every request.

Methods:

| Method | HTTP | OpenViking endpoint |
|---|---|---|
| `remember(text, metadata)` | `POST /api/v1/memories` | Store with auto-embedding |
| `recall(query, opts)` | `POST /api/v1/memories/search` | Semantic retrieval |
| `find(path)` | `GET /api/v1/memories?path=...` | Directory lookup |
| `abstract(memoryIds)` | `POST /api/v1/memories/abstract` | Summarize/compress |
| `stats()` | `GET /api/v1/stats/memories` | Count + per-category |

Same `{ ok, data } | { ok, error }` return pattern as vault-client.

### 5.4 Tools

**`viking_remember`** — store a memory:
- Input: `{ text: string, category?: string, tags?: string[], metadata?: Record<string, string> }`
- Calls `vikingClient.remember(text, { category, tags, ...metadata })`
- Returns: `{ id, path, created }`

**`viking_recall`** — semantic search:
- Input: `{ query: string, limit?: number, category?: string }`
- Calls `vikingClient.recall(query, { limit, category })`
- Returns: array of `{ id, text, score, category, created }`

**`viking_find`** — structured lookup:
- Input: `{ path: string }`
- Calls `vikingClient.find(path)`
- Returns: array of `{ id, text, path, category }`

**`viking_abstract`** — compress memories:
- Input: `{ memoryIds: string[], targetLevel?: "L1" | "L2" }`
- Calls `vikingClient.abstract(memoryIds)`
- Returns: `{ abstractId, summary, sourceCount }`

### 5.5 Data provider

**`memory-stats`** — for dashboard/KPI consumption:
- Calls `vikingClient.stats()`
- Returns: `{ total: number, byCategory: Record<string, number> }`

---

## 6. Shared concerns

### 6.1 Build system

Both plugins are pnpm workspace packages. Add to `pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/vault-plugin"
  - "packages/openviking-plugin"
```

(Already covered by the existing `"packages/*"` glob — no change needed.)

Build with `pnpm --filter @agenticos/vault-plugin build` (esbuild, single
`dist/worker.js` output). Turbo handles the build orchestration.

### 6.2 Plugin loading

Paperclip discovers plugins from `PAPERCLIP_HOME/plugins/`. The bind-mounts
in docker-compose map each plugin's `dist/` directory to a subdirectory:

```yaml
- ./packages/vault-plugin/dist:/paperclip/plugins/vault-plugin:ro
- ./packages/openviking-plugin/dist:/paperclip/plugins/openviking-plugin:ro
```

Each `dist/` must contain the bundled `worker.js` and a `manifest.json`
(generated from the TypeScript manifest during build).

### 6.3 Error handling

Both clients use the same pattern:
- All HTTP calls wrapped in try/catch with timeout via `AbortController`
- Return `{ ok: true, data }` on success, `{ ok: false, error: string }` on failure
- Tools return the error message to the agent — the agent can reason about what
  went wrong and retry or skip
- Plugin never crashes on downstream service failure

### 6.4 Testing

- `vault-client.test.ts` / `viking-client.test.ts`: mock `fetch`, test each method
- `tools.test.ts`: mock the client, test tool handlers map inputs → outputs correctly
- Run via `pnpm test` (vitest)

---

## 7. Acceptance criteria

1. `gh repo view EngineeringMoonBear/paperclip` succeeds — fork exists with
   `agenticos-v0.1.0` tag
2. `docker compose up paperclip-server` boots successfully, connects to
   `agenticos-db`, and serves `http://10.116.16.2:3100/api/health`
3. Postgres `agenticos` database contains 80+ Paperclip tables alongside
   the existing Hermes-era tables
4. `@agenticos/vault-plugin` builds (`pnpm build`), passes tests, and exposes
   `vault_search`, `vault_read`, `vault_list`, `vault_stats`, `vault_discard`
5. `@agenticos/openviking-plugin` builds, passes tests, and exposes
   `viking_remember`, `viking_recall`, `viking_find`, `viking_abstract`
6. Both plugins load in Paperclip (visible in admin/plugins or logs)
7. Hermes services remain running and functional — zero disruption to
   the existing stack during migration
8. All governance invariants preserved: vault plugin never touches filesystem,
   only write is inbox discard, no auto-promotion

---

## 8. Out of scope (steps 5+)

- Theme override (step 5)
- Agent roster creation (step 6)
- Adapter routing configuration (step 7)
- Scheduled routines (step 8)
- GitHub Issues sync (step 9)
- KPI Vista port (step 10)
- Hermes retirement (step 11)
- Terraform updates (step 12)
- App Platform deployment (step 13)
