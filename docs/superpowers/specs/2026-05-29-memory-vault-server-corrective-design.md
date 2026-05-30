# Corrective Architecture — Vault Server + Memory Tab Realignment

**Spec date:** 2026-05-29
**Status:** approved (brainstorm complete, awaiting writing-plans handoff)
**Supersedes parts of:** [v2 unified dashboard spec](./2026-05-25-v2-unified-dashboard-design.md) §3 decision #5 and §4 architecture
**Prior art:** [v2 unified dashboard implementation plan](../../plans/v2-unified-dashboard.md) Phase 4

---

## 1. Goal

Restore the Memory tab to actually show the user's Obsidian vault contents instead of empty stubs and a broken Viking-shim UI. Get there by adding a tiny `vault-server` service on the Droplet that exposes `/opt/vault` over HTTP on the VPC, and rewiring the dashboard's `/api/vault/*` routes to proxy to it — the same shape the dashboard already uses for OpenViking and Postgres.

This is corrective work, not new feature work. It undoes a wrong premise from Phase 4 (PR #106 was built as if Viking already had data) and replaces it with the architecture that matches the user's actual mental model.

## 2. Scope check

Single feature: connect the dashboard's Memory tab to the real vault on the Droplet, plus the realignment of related stubs to either real impls or honest empty states. Fits one implementation plan, ~10-15 hours of focused work.

## 3. Locked decisions (from brainstorm)

| # | Question | Decision |
|---|----------|----------|
| 1 | What does "Memory" mean in the dashboard? | The vault-driven browser/reader for the user's Obsidian content (markdown, wiki, sources, skill *definitions*). NOT a Viking observability surface. |
| 2 | Where does the vault physically live? | `/opt/vault` on the Droplet. Syncthing bidirectionally pairs it with the user's Mac. Verified working (`.stfolder` marker present, `HELLO-FROM-{MAC,DROPLET}.md` handshake files present, `farming/` content present, `syncthing@deploy.service` `active`). |
| 3 | How does the dashboard physically reach `/opt/vault`? | Through a new `vault-server` service on the Droplet (Fastify + `@agenticos/vault-core`), bound to the Droplet's VPC private IP at `10.10.0.5:7777`. App Platform's dashboard proxies via `VAULT_SERVER_URL` env var. Same pattern as PR #112 used for Viking and Postgres. |
| 4 | Where does the dashboard run? | **Stays on App Platform** (decision revised after pushback). Preserves PR #112's env wiring, the auto-deploy-on-push webhook, the Cloudflare CNAME, the stateless ↔ stateful boundary. |
| 5 | What does "Memory tab" UI become? | Revert to the legacy vault-driven components (`MemoryTree`, `MemoryReader`, `MemoryRail`, `InboxQueue`, `LintPanel`, `PromoteReviewDrawer`, `GraphCanvas`) that PR #107 deleted. Delete the misnamed Viking-premise components from PR #106 (`CategoryBrowser`, `AbstractList`, `DetailView`, `RetrievalTrajectoryGraph`) + their hooks + their `/api/memory/*` route handlers. |
| 6 | What about OpenViking observability? | Keep it in the AgenticOS dashboard as its own surface (panel or sub-route), **with real metrics** (uptime, scope counts which are honestly 0 until Hermes ships, RAM via Droplet metrics). Stub data is unacceptable. Link out to Viking's own UI at `:1933` for deep inspection. |
| 7 | Skills catalog source | Skill *definitions* come from the vault (`vault/skills/*.md` frontmatter). Skill *runtime* state will come from Viking once Hermes is deployed. The dashboard panel reads vault-side for v1; Viking-side becomes a follow-up when there's data to read. |
| 8 | `/api/vault/recent-changes` data source | Real impl in vault-server polling Syncthing's REST API (`http://127.0.0.1:8384/rest/events?since=...` with the API key from `~/.config/syncthing/config.xml`). No more hardcoded farming/* stubs. |
| 9 | Public access pattern | Unchanged from today. Cloudflare CNAME → App Platform → CF Access (Google SSO) gate stays. Droplet remains private-VPC-only. |
| 10 | Deploy mechanism | App Platform's existing webhook auto-deploys the dashboard on push to main. Droplet-side now needs a small `.github/workflows/deploy-droplet.yml` to rebuild and restart the new `vault-server` service when `infra/vault-server/**` or the compose file changes. Resolves the long-pending Asana #16. |

## 4. Architecture (delta over current state)

```
                Mac (Obsidian + Syncthing)
                          │
                          ▼  Syncthing bidirectional
        ┌───────────────────────────────────────┐
        │             Droplet                   │
        │                                       │
        │  /opt/vault  ◄─ syncthing@deploy      │
        │       │                               │
        │       │ bind-mount (read-only)        │
        │       ▼                               │
        │  ┌────────────────────────┐           │
        │  │  vault-server          │  NEW      │
        │  │  Fastify wrapper       │           │
        │  │  around vault-core     │           │
        │  │  + Syncthing REST      │           │
        │  │  10.10.0.5:7777        │           │
        │  └────────────────────────┘           │
        │       ▲                               │
        │       │  internal docker network      │
        │       │                               │
        │  ┌──────────┐  ┌──────────────┐       │
        │  │openviking│  │agenticos-db  │       │
        │  │  :1933   │  │  :5432       │       │
        │  └──────────┘  └──────────────┘       │
        │       ▲              ▲                │
        │       │   PR #112 VPC binding         │
        └───────┼──────────────┼────────────────┘
                │              │
                │   (VPC 10.10.0.0/16, private)
                │              │
        ┌───────┴──────────────┴────────────────┐
        │         App Platform                  │
        │                                       │
        │  Next.js dashboard                    │
        │  /api/vault/*   → vault-server (NEW)  │
        │  /api/memory/*  → openviking (kept    │
        │     for the OpenViking obs surface,   │
        │     not for the Memory tab itself)    │
        │  /api/tasks/*   → agenticos-db        │
        └───────────────┬───────────────────────┘
                        │
                        ▼
              Cloudflare (CF Access SSO)
                        │
                        ▼
                     Browser
```

The only architectural delta is the `vault-server` service. Every other arrow already exists or stays exactly as it was after PR #112.

## 5. Components

### 5.1 `infra/vault-server/` (new — Droplet-side)

Tiny Fastify service. Single responsibility: expose `/opt/vault` and the Syncthing event stream over HTTP to other VPC-resident services.

- Language/runtime: Node 22 + TypeScript + Fastify. Same Node version as the dashboard so we can reuse `@agenticos/vault-core` directly as a workspace dep.
- Container: built from a Dockerfile at `infra/vault-server/Dockerfile`. Multi-stage: pnpm install + tsc build, then a `node:22-slim` runtime with just the built JS + `node_modules`.
- Bind mount: `/opt/vault:/app/vault:ro` (read-only — the dashboard never writes through this path; inbox commits go through a different flow we'll define if/when we need them).
- Syncthing API access: reads the API key from `/home/deploy/.config/syncthing/config.xml` (bind-mounted in too, read-only). Polls `http://172.17.0.1:8384/rest/events` (the Droplet's docker bridge — Syncthing binds on `0.0.0.0:8384` so accessible from inside the container).
- Port: binds on `10.10.0.5:7777` published in docker-compose (NOT `127.0.0.1:7777`). Same VPC-IP-binding pattern PR #112 established for Viking and Postgres.
- Env: `VAULT_ROOT=/app/vault`, `SYNCTHING_URL=http://172.17.0.1:8384`, `SYNCTHING_API_KEY=…` (read from env file or from the bind-mounted config.xml at startup).
- Routes (mirror the dashboard's current vault routes one-for-one):
  - `GET /tree` — full tree of `/opt/vault`
  - `GET /page?path=…` — single file content + parsed frontmatter + wikilinks
  - `GET /search?q=…` — full-text search (start with `ripgrep` shelling out; sqlite-FTS later if needed)
  - `GET /stats` — page count, recent activity summary
  - `GET /backlinks?path=…` — incoming wikilinks to a page
  - `GET /recent-changes?since=…` — Syncthing event log filtered to FolderCompletion/ItemFinished events for the vault folder
  - `GET /inbox` — list of files under `inbox/`
  - `POST /inbox/promote` / `POST /inbox/discard` / `POST /inbox/commit` — promotes vault inbox items into the wiki tree (real fs writes — the only writes this service does)
  - `GET /health` — liveness probe
- Auth: tenant-style headers (`X-Vault-Account: agenticos`, `X-Vault-User: deploy`) — soft for now, hard once we add other consumers. Same shape as Viking.
- No persistent state, no DB. The service is stateless.

### 5.2 `apps/dashboard/lib/vault/store-singleton.ts` (refactor)

Today it constructs an `InMemoryVaultStore` from `@agenticos/vault-core` pointed at a local filesystem path. After this work, it returns a `RemoteVaultClient` that wraps `fetch(VAULT_SERVER_URL + endpoint)` calls. The route handlers in `app/api/vault/*` keep their signatures and shape — only the inside of `getVaultStore()` changes.

`InMemoryVaultStore` does not need to be deleted from `@agenticos/vault-core`; it's still useful for tests and for the new `vault-server` service to actually read the disk.

### 5.3 `apps/dashboard/app/api/vault/recent-changes/route.ts` (rewrite)

Today it returns hardcoded stub. After this work, it proxies to `vault-server`'s `/recent-changes` endpoint, which polls Syncthing's REST API and returns real file events with real timestamps.

### 5.4 `apps/dashboard/components/memory/*` (restore + delete)

- **Restore** (via `git checkout ad14586^ -- <file>`):
  - `MemoryTree.tsx`
  - `MemoryReader.tsx`
  - `MemoryRail.tsx`
  - `InboxQueue.tsx`
  - `LintPanel.tsx` (consumer of `MemoryRail`)
  - `PromoteReviewDrawer.tsx` (consumer of `InboxQueue`)
  - `GraphCanvas.tsx`
- **Delete** (shipped in PRs #106 + #107):
  - `CategoryBrowser.tsx` + `.test.tsx`
  - `AbstractList.tsx` + `.test.tsx`
  - `DetailView.tsx` + `.test.tsx`
  - `RetrievalTrajectoryGraph.tsx` + `.test.tsx`

### 5.5 `apps/dashboard/app/memory/page.tsx` (rewire)

Replace the current three-column Viking-premise layout with the legacy vault-driven layout from the pre-PR-#107 state. Keep the `MemoryVista` hero from PR #104. Keep the `MemorySyncIndicator` header. Drop the three placeholder panels (`OpenVikingSummaryPanel`, `SkillsCatalogPanel`, `RecentVaultChangesPanel`) from the top stripe — they need to be replaced with real-data versions in a separate sub-step (5.7 below).

### 5.6 `apps/dashboard/app/api/memory/*` routes (mostly delete)

- **Delete**:
  - `tree/route.ts` + test
  - `abstracts/route.ts` + test
  - `overview/route.ts` + test
  - `detail/route.ts` + test
  - `trajectory/route.ts` + test
  - `scopes/route.ts` (stub)
  - `skills/route.ts` (stub)
- **Keep**:
  - The `/api/memory/*` namespace remains reserved for *real* OpenViking observability when Hermes ships. New routes will go here, but they read Viking honestly (even if Viking is empty).

### 5.7 OpenViking observability surface (rebuild)

Not the "Memory tab" — a separate section, ideally a small panel inside Architecture or Health (TBD in the implementation plan). Routes:

- `GET /api/viking/health` — uptime, version, RAM via Viking's `/api/v1/observer/system` endpoint
- `GET /api/viking/scopes` — actual scope counts from Viking's `/api/v1/stats/memories`, returns honest zeros when empty
- Component renders `0 / 0 / 0 / 0` clearly, not as a "loading" affordance. Adds a "Viking is empty — Hermes hasn't been deployed yet" empty state once Viking is reachable but empty.

### 5.8 Skills catalog (vault-driven)

- `vault-server` exposes `GET /skills` reading `/opt/vault/skills/*.md` frontmatter and parsing `name`, `description`, `triggers`, `used_by`, etc.
- Dashboard proxy at `/api/vault/skills` (note: under `/vault`, not `/memory`).
- `SkillsCatalogPanel` rewired to consume the new route.

### 5.9 Infrastructure

- `infra/terraform/app-platform.tf`: add `VAULT_SERVER_URL=http://10.10.0.5:7777` env block (RUN_TIME, no SECRET).
- `infra/cloud-init/droplet-bootstrap.yaml.tpl`: no change — the compose file is what changes.
- `infra/README.md`: delete the stale line claiming "Zero Trust Tunnel `agenticos-app-platform`" — no such resource exists in Terraform and per §13 we intentionally don't build one. Also drop the `Account → Cloudflare Tunnel → Edit` permission from the documented API token scopes since we don't use it.
- `docker-compose.yml` (repo root — synced to the Droplet at `/opt/agenticos/docker-compose.yml` by cloud-init's `cp`): add `vault-server` service. Bind on `10.10.0.5:7777`. Bind-mount `/opt/vault:/app/vault:ro` and `/home/deploy/.config/syncthing:/syncthing-config:ro`. The Syncthing REST API at `http://172.17.0.1:8384` is reachable from inside the container because Syncthing binds on `0.0.0.0:8384` and `172.17.0.1` is the default docker bridge gateway on Linux (`docker network inspect bridge` to confirm if needed — alternatively switch to `host.docker.internal` via `extra_hosts: ["host.docker.internal:host-gateway"]` if portability matters).
- UFW: allow `10.10.0.0/16 → :7777` (same pattern as PR #112 used for `:1933` and `:5432`).
- `.github/workflows/deploy-droplet.yml`: new workflow, SSH-based, triggered when `infra/vault-server/**` or `infra/agenticos-droplet/docker-compose.yml` changes on main. Rebuilds the `vault-server` image, runs `docker compose up -d vault-server`. Resolves Asana #16.

## 6. Data flow scenarios

### Scenario A — User opens Memory tab and clicks a folder

```
Browser → CF Access (auth) → App Platform Next.js (/memory page renders, MemoryTree fetches)
        → /api/vault/tree → RemoteVaultClient
        → fetch(10.10.0.5:7777/tree) [VPC]
        → vault-server reads /opt/vault via vault-core
        → JSON response back through the chain
        → MemoryTree renders folder structure
        → User clicks "farming/" — recursive expansion fires another /api/vault/page request per click
```

End-to-end latency budget: <500ms warm.

### Scenario B — User edits a markdown file in Obsidian on Mac

```
Mac Obsidian writes file → Mac Syncthing detects change → syncthing event emitted
        → bidirectional sync to Droplet → /opt/vault gets the new file
        → vault-server's /recent-changes poller catches the event next time it polls
        → MemorySyncIndicator's poll picks up the change indicator
        → MemoryTree refetches (TanStack staleTime expires)
        → User sees the new file in the dashboard within ~30s
```

### Scenario C — User views OpenViking observability panel before Hermes is deployed

```
Browser → /api/viking/scopes → Next.js handler → fetch(viking:1933/api/v1/stats/memories)
        → Viking returns {total: 0, scopes: {...all empty...}}
        → Dashboard renders "0 / 0 / 0 / 0" + empty-state hint
        → No deception, no stubs, no surprise when scopes do start populating
```

## 7. Error handling

- **vault-server unreachable from App Platform**: dashboard's `/api/vault/*` routes return 502 with a clear error message. UI shows "Vault unavailable" affordance, not a hang. Tests for this in dashboard-load.spec.ts (Playwright).
- **Vault read errors (permissions, malformed frontmatter)**: vault-server returns 500 with the parse error; dashboard surfaces it inline in the file view, not as a tab-wide crash.
- **Syncthing API unreachable from vault-server**: `/recent-changes` returns an empty event list with `{available: false}`; UI shows "Live sync indicator offline" instead of hanging.
- **Inbox commit conflict** (write race): vault-server serializes inbox writes through a mutex. Returns 409 on conflict; UI re-fetches and offers to retry.

## 8. Out of scope (deferred)

- **OpenViking-side ingestion** (Hermes deploy + curator job that walks `/opt/vault` and writes into Viking). That's the next phase, gated on having Hermes running.
- **Full-text search via sqlite-fts** in vault-server. Start with ripgrep for v1; upgrade when corpus grows past ~10k files.
- **Vault content write path** beyond inbox commits. Editing wiki pages happens in Obsidian on the Mac; the dashboard is read-mostly.
- **Viking memory provider scope counters wired into the AgenticOS dashboard's KPI tiles**. Those tiles can stay decorative (or get replaced with vault-side counts) until Viking has data.

## 9. Open questions

- **Should the vault-server need its own auth token?** For v1 it relies on VPC isolation (same as Viking + Postgres bindings post PR #112). If we ever expose it via Tailscale or Cloudflare Tunnel for some reason, we'd add a shared secret. Decision: skip for now, document the assumption.
- **Skill `.md` frontmatter schema** — do we define one now or wait until you write a few real skills? Decision: write the frontmatter consumer permissively (any string is a skill name, missing fields are tolerated). Tighten when patterns emerge.
- **`MemorySyncIndicator` polling source** — today it polls `/api/vault/stats`; should it switch to a dedicated `/api/vault/sync-status` that aggregates Syncthing's completion percentage and the last successful sync timestamp? Decision: yes, but as a small follow-up after vault-server lands.

## 10. Acceptance criteria

The corrective work ships when all of the following hold true in production:

1. SSH-into-Droplet → `docker compose ps vault-server` shows `healthy`.
2. From App Platform's container (verified via the dashboard's own server-side logs), `fetch("http://10.10.0.5:7777/health")` returns `{ok: true}` in <100ms.
3. Visiting `/memory` in the browser shows the **legacy three-pane layout** (tree on left, reader in middle, rail on right), populated with the actual `/opt/vault` content (the `farming/` tree, the `HELLO-FROM-*` files, anything else in the paired vault).
4. Editing a `.md` file in Obsidian on the Mac → save → switch to the dashboard tab → the file shows up under "Recent vault changes" within ~30 seconds with a real timestamp (not a hardcoded `13:45`).
5. The "OpenViking summary" panel (if kept in the layout) shows real zeros, not stubs.
6. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and the E2E suite all stay green.
7. `terraform plan` against the updated `app-platform.tf` shows exactly one change: the new `VAULT_SERVER_URL` env block. No other drift.
8. The `.github/workflows/deploy-droplet.yml` workflow runs successfully on its first push (or its manual trigger), demonstrating the Droplet-side deploy path works.

## 11. Implementation phasing

Five phases, sequenced so each is shippable on its own and the production /memory tab stays functional throughout:

1. **Phase A — vault-server scaffolding** (~3 hrs). Create `infra/vault-server/` workspace. Fastify app with the route stubs. Dockerfile. Add to docker-compose. Bind on 10.10.0.5:7777. UFW rule. Verify reachable from inside the App Platform container via a one-off `fetch` test.
2. **Phase B — wire vault-server's read endpoints** (~3 hrs). Real implementations of `/tree`, `/page`, `/stats`, `/backlinks`, `/inbox`, using `@agenticos/vault-core` as the library. Tests.
3. **Phase C — Dashboard rewire** (~3 hrs). Refactor `lib/vault/store-singleton.ts` to use `RemoteVaultClient`. Add `VAULT_SERVER_URL` env. App Platform env block added to Terraform. `/api/vault/*` route handlers now proxy. Verify in prod.
4. **Phase D — Memory tab UI revert** (~2 hrs). Restore legacy components via git checkout. Delete Viking-premise components + their hooks + their `/api/memory/{tree,abstracts,overview,detail,trajectory}` routes. Rewire `app/memory/page.tsx`. Verify the tree, reader, rail all render against real vault data.
5. **Phase E — Stubs to real impls** (~3 hrs). `/api/vault/recent-changes` via Syncthing REST API. Vault-driven skills catalog at `/api/vault/skills`. Real OpenViking observability routes (`/api/viking/health`, `/api/viking/scopes`) returning honest zeros. Delete `/api/memory/scopes` and `/api/memory/skills` stub routes.
6. **Phase F — Deploy automation + Asana #16** (~2 hrs). Write `.github/workflows/deploy-droplet.yml`. Triggers on push to main when `infra/vault-server/**` or `docker-compose.yml` (repo root) changes. Adds SSH key to GH secrets. First successful auto-deploy on a push proves the end-to-end path. Marks Asana #16 done.

Estimated total: ~16 hours.

## 12. Dependencies on other work

- **PR #112's App Platform → Droplet VPC wiring** must remain in place. This spec builds on it.
- **PR #113's pre-commit hooks** automatically gate this spec's Terraform changes.
- **No Hermes deploy required for any of this work.** Viking observability surfaces will show zeros, which is the honest state.

## 13. Non-goals

- This is **not** a feature add. Every change is corrective.
- This is **not** a redesign of the Memory tab's visual identity. We restore the previously-shipped legacy layout.
- This is **not** moving the dashboard off App Platform. (We considered it; you correctly pushed back.)
- This is **not** the place where Hermes-driven Viking ingestion lands. That's the next phase.
- **No Cloudflare Tunnel.** The current CNAME-proxied pattern (`agenticos.gatheringatthegrove.com` → App Platform's `.ondigitalocean.app` hostname, proxied by Cloudflare, gated by CF Access) is the right shape for our setup. Tunnels are valuable when the origin is a private-network service that needs to be made publicly addressable — App Platform is intentionally a public managed service, and the Droplet is intentionally not public (and stays that way per this spec). The `infra/README.md` line claiming a tunnel exists is stale and gets removed (see §5.9). When/if we ever expose Droplet-side surfaces publicly (syncthing GUI without Tailscale, OpenViking's own UI), the tunnel becomes the canonical pattern and can land as a small follow-up.

---

**End of design.**
