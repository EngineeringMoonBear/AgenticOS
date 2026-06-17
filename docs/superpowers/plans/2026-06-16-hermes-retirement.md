# Hermes Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire Hermes entirely — repoint the dashboard onto Paperclip's REST API, port `vault_ingest` as a $0 plugin job, then delete all Hermes services/packages/cloud-init — losing zero value the operator consumes.

**Architecture:** Five gated phases (preview-first, parallel-run). Phase 1 stands the dashboard up against Paperclip's API behind a feature flag while Hermes stays live. Phase 2 ports `vault_ingest` and runs it alongside Hermes's. Phase 3 flips the flag (cutover). Phases 4–5 delete Hermes. The Hermes Postgres becomes a read-only archive — no data migration.

**Tech Stack:** Next.js (dashboard, DO App Platform), TypeScript, vitest, `@paperclipai/plugin-sdk` plugins (esbuild), Paperclip REST API (board-key auth over the VPC), docker-compose, Terraform/cloud-init.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-16-hermes-retirement-design.md](../specs/2026-06-16-hermes-retirement-design.md). Implements [ADR 0006](../../adr/0006-hermes-to-paperclip-runtime.md).
- Paperclip pinned at `2026.609.0`. Read via its **REST API**, never direct `paperclip`-DB table reads.
- Plugin secret-resolution is **disabled** in this version — plugin config (incl. the board key path) is plain config set via `scripts/sync-paperclip-secrets.sh`. Do NOT use `format:"secret-ref"`/`ctx.secrets`.
- `vault_ingest` must stay **$0 + deterministic** (local Ollama embeddings, no reasoning LLM) so it's exempt from Paperclip's cost-blindness (cost is only tracked for agent/adapter LLM calls).
- **No cost-history migration.** Hermes Postgres (`tasks/sessions/calls/budget/vault_ingest_state`) becomes a read-only archive.
- Sequencing is **gated**: never retire a Hermes service until its replacement has run clean for 2–3 cycles. Dashboard cutover (Phase 3) is gated on the preview (Phase 1) + vault_ingest verification (Phase 2).
- Commits: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit`, message ends `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never push `main` directly; branch + PR.
- Plugin workers must bundle the SDK (`esbuild --bundle --external:react`), never `--external:@paperclipai/plugin-sdk`.

---

## Phase 1 — Dashboard preview on Paperclip API (Hermes untouched)

> **Re-spec'd 2026-06-17.** During execution this phase proved ~3x scope (~10 Hermes endpoints across ~12 consumers). The foundation (Tasks 1.1–1.4) shipped in PR #180; the rest became a standalone effort — see [Dashboard Paperclip Repoint plan](2026-06-17-dashboard-paperclip-repoint.md) (Phases A–D) and the [ADR 0006 amendment](../../adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed) (dashboard kept + repointed, not replaced by Paperclip's UI). Tasks 1.5/1.6 below are superseded by that plan.

### Task 1.1: Paperclip API read client

**Files:**
- Create: `apps/dashboard/lib/paperclip/client.ts`
- Test: `apps/dashboard/lib/paperclip/client.test.ts`

**Interfaces:**
- Consumes: `PAPERCLIP_API_URL`, `PAPERCLIP_BOARD_KEY`, `PAPERCLIP_COMPANY_ID` from env (Task 1.6).
- Produces: `createPaperclipClient(cfg): PaperclipClient` with methods `costSummary({from,to})`, `costByAgentModel({from,to})`, `heartbeatRuns({limit,status?})`, `activity({limit})`, `agents()`, `health()`. Each returns a typed `Result<T> = {ok:true,data:T} | {ok:false,error:string}` (mirror the `vault-client.ts` Result pattern already in the repo).

- [ ] **Step 1: Write failing tests** (mocked `fetch`): assert each method calls the correct path with `Authorization: Bearer <key>`, parses the documented response shape, and returns `{ok:false}` on non-2xx. Endpoints (verified in `/tmp/pc-verify`, `server/src/routes/costs.ts:173`, `agents.ts:3293`, `activity.ts:75`, `health.ts:81`):
  - `GET {API}/api/companies/{companyId}/costs/summary?from=&to=`
  - `GET {API}/api/companies/{companyId}/costs/by-agent-model?from=&to=`
  - `GET {API}/api/companies/{companyId}/heartbeat-runs?limit=&status=`
  - `GET {API}/api/companies/{companyId}/activity?limit=`
  - `GET {API}/api/companies/{companyId}/agents`
  - `GET {API}/api/health`
- [ ] **Step 2:** Run `pnpm --filter @agenticos/dashboard test client.test` → FAIL (module missing).
- [ ] **Step 3:** Implement `client.ts`: a `fetchJson` helper that sets the bearer header + a per-request `AbortSignal.timeout(8000)`, maps non-2xx → `{ok:false,error}`, and the six typed methods. No retries (dashboard polls).
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit (`feat(dashboard): paperclip API read client`).

### Task 1.2: `/api/costs` route (Paperclip-backed)

**Files:**
- Create: `apps/dashboard/app/api/costs/route.ts`
- Test: `apps/dashboard/app/api/costs/route.test.ts`

**Interfaces:**
- Consumes: `createPaperclipClient` (1.1).
- Produces: `GET /api/costs?from=&to=` → `{ totalCents, budgetCents, byModel: [{provider,model,costCents}] }` — the exact shape `CostVista`/`CostBurndownChart` already consume from the old `/api/tasks`-derived data (read those components first to match field names).

- [ ] **Step 1:** Write failing test: mock the Paperclip client, assert the route composes `costSummary` + `costByAgentModel` into the dashboard shape, and returns `503 {error}` when the client returns `{ok:false}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the route handler.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 1.3: `/api/runs` route (heartbeat-runs + activity)

**Files:**
- Create: `apps/dashboard/app/api/runs/route.ts`
- Test: `apps/dashboard/app/api/runs/route.test.ts`

**Interfaces:**
- Produces: `GET /api/runs?limit=` → the event shape `RunsVista`/`run-feed.tsx`/`live-runs-strip.tsx` consume (read those to match). Map each `heartbeat_run` → `{id, kind, status, startedAt, endedAt, costCents?}`.

- [ ] **Step 1:** Failing test: mock client, assert mapping of `heartbeat-runs` to the run-feed shape + `live` filter (status in queued|running).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task 1.4: `/api/agent/health` repoint (synthesized)

**Files:**
- Modify: `apps/dashboard/app/api/agent/health/route.ts`
- Test: `apps/dashboard/app/api/agent/health/route.test.ts`

**Interfaces:**
- Produces: same response shape the existing `AgentStatusChip`/`metrics-sidebar` consume, now **synthesized** from `agents()` (status) + latest `heartbeatRuns({limit:1})` (`livenessState`, `lastOutputAt`). Health = `ok` if an agent is running and its last run isn't `livenessState:stuck`; `degraded` otherwise; `down` if `health()` fails.

- [ ] **Step 1:** Failing test covering the three states (ok/degraded/down) from mocked client responses. **Step 2:** FAIL. **Step 3:** Implement synthesis. **Step 4:** PASS. **Step 5:** Commit.

### Task 1.5: Feature-flag the data source + wire components

**Files:**
- Create: `apps/dashboard/lib/config/data-source.ts` (`dataSource(): "hermes" | "paperclip"` from `DASHBOARD_DATA_SOURCE` env, default `"hermes"`)
- Modify: `CostVista.tsx`, `RunsVista.tsx`, `AgentStatusChip.tsx` (+ any hook in `lib/` they call) to fetch `/api/costs`,`/api/runs`,`/api/agent/health` when `dataSource()==="paperclip"`, else the existing `/api/tasks` path.

**Interfaces:**
- Consumes: routes 1.2–1.4.
- Produces: nothing new — preserves existing component props.

- [ ] **Step 1:** Add `data-source.ts` + a test asserting default `hermes` and `paperclip` when env set.
- [ ] **Step 2:** Gate the three components' fetch URLs on `dataSource()`. (No behavior change at default.)
- [ ] **Step 3:** Run `pnpm --filter @agenticos/dashboard test` → PASS (existing tests unaffected at default).
- [ ] **Step 4:** Commit.

### Task 1.6: Env + App Platform wiring + preview deploy

**Files:**
- Modify: `apps/dashboard/lib/config/schema.ts` (add `PAPERCLIP_API_URL`, `PAPERCLIP_BOARD_KEY`, `PAPERCLIP_COMPANY_ID`, `DASHBOARD_DATA_SOURCE` — all optional, validated)
- Modify: `infra/terraform/app-platform.tf` (add the three Paperclip env vars; `PAPERCLIP_API_URL=http://10.116.16.2:3100`, board key from the same 1Password item, company id `GOL`'s id)

- [ ] **Step 1:** Extend the zod schema; test that missing Paperclip vars is OK when `DASHBOARD_DATA_SOURCE!=="paperclip"` and required when it is.
- [ ] **Step 2:** Add the env vars to `app-platform.tf` (board key as a secret ref var, mirroring `openviking_root_api_key`). `terraform fmt`.
- [ ] **Step 3:** Commit. Open PR. **Acceptance gate (manual):** deploy the branch to a preview, set `DASHBOARD_DATA_SOURCE=paperclip`, confirm Cost tab + agent-health render against real Paperclip data with Hermes still live.

---

## Phase 2 — Port `vault_ingest` as a $0 plugin job

### Task 2.1: openviking-plugin manifest — add the ingest job

**Files:**
- Modify: `packages/openviking-plugin/src/manifest.ts`

**Interfaces:**
- Produces: a `jobs: [{ jobKey: "vault-ingest", displayName, schedule: "0 * * * *" }]` entry; add `database.namespace.write` + `database.namespace.read` to `capabilities` (keep `http.outbound`); add config fields `vaultServerUrl` (default `http://vault-server:7777`) to the existing `instanceConfigSchema`.

- [ ] **Step 1:** Edit manifest. **Step 2:** `pnpm --filter @agenticos/openviking-plugin build` → confirm `dist/manifest.js` carries the job + capability (`node -e "import m ..."`). **Step 3:** Commit.

### Task 2.2: vault reader + sha reconciliation

**Files:**
- Create: `packages/openviking-plugin/src/ingest/vault-reader.ts` (list vault `.md` via vault-server `GET /list` + `GET /page`, excluding `inbox/` + dotfiles; return `{path, content, sha256}[]`)
- Create: `packages/openviking-plugin/src/ingest/reconcile.ts` (pure: `diff(current, prior): {add, update, remove}` by path→sha)
- Test: `packages/openviking-plugin/tests/reconcile.test.ts`, `tests/vault-reader.test.ts`

**Interfaces:**
- Produces: `readVault(vaultServerUrl): Promise<VaultFile[]>` where `VaultFile = {path:string, content:string, sha256:string}`; `diff(current: VaultFile[], prior: Map<string,string>): {add:VaultFile[], update:VaultFile[], remove:string[]}`.
- Consumes (2.3): the plugin DB namespace as the `prior` store.

- [ ] **Step 1:** Failing tests — `diff` over fixtures (new/changed/removed/unchanged); `vault-reader` with mocked `fetch` asserting `inbox/` + dotfiles excluded and SHA computed. **Step 2:** FAIL. **Step 3:** Implement (port `walk_vault` + SHA logic from `vault_ingest.py:67`). **Step 4:** PASS. **Step 5:** Commit.

### Task 2.3: the `vault-ingest` job handler

**Files:**
- Modify: `packages/openviking-plugin/src/worker.ts` (register the job via `ctx.jobs.register("vault-ingest", ...)`)
- Create: `packages/openviking-plugin/src/ingest/job.ts` (`runVaultIngest({reader, viking, state, vaultServerUrl})`)
- Test: `packages/openviking-plugin/tests/ingest-job.test.ts`

**Interfaces:**
- Consumes: `readVault`/`diff` (2.2); the existing `VikingClient` (its `addResource`/`rm` methods — verify names in `viking-client.ts`); `ctx.db` namespace for state (`path→sha`).
- Produces: a job fn that fetch→diff→`addResource` for add/update→`rm` for remove→upsert state; returns `{added,updated,removed,errors}` summary; logs via `ctx.logger`. Per-file errors are collected, not fatal (mirror `pr-triage`).

- [ ] **Step 1:** Failing test: mock reader + VikingClient + state store; assert add/update call `addResource`, remove calls `rm`, state is upserted, and a failing file is isolated (summary `errors:1`, others still processed).
- [ ] **Step 2:** FAIL. **Step 3:** Implement `job.ts` + register in `worker.ts` (build the VikingClient via the existing `build(ctx)` helper). **Step 4:** PASS + `pnpm --filter @agenticos/openviking-plugin typecheck`.
- [ ] **Step 5:** Build, confirm worker imports standalone (`node --input-type=module -e "import('.../dist/worker.js')"`). Commit. Open PR.

### Task 2.4: Parallel-run verification (acceptance gate)

- [ ] **Step 1:** Merge Task 2.3; the plugin auto-deploys (`deploy-droplet-plugins.yml`). Install/refresh via `sync-paperclip-secrets.sh` (manifest changed → reinstall).
- [ ] **Step 2:** Let the Paperclip `vault-ingest` job and Hermes's hourly `vault-ingest` run in parallel for 2–3 cycles. Diff the OpenViking resource set / counts; confirm parity.
- [ ] **Step 3:** Disable Hermes's `vault-ingest` cron only (leave other Hermes intact): `docker exec hermes-agent hermes cron delete vault-ingest` (or edit `jobs.json`). Document in the PR.

---

## Phase 3 — Cutover (gated on Phases 1 + 2)

### Task 3.1: Flip the dashboard data source

**Files:** Modify `infra/terraform/app-platform.tf` — set `DASHBOARD_DATA_SOURCE=paperclip` on the live dashboard.

- [ ] **Step 1:** Confirm the Phase 1 preview gate passed. **Step 2:** Set the env var, `terraform fmt`, commit, PR, apply. **Step 3:** Verify live dashboard Cost/Runs/health render from Paperclip. Keep the Hermes Postgres readable for rollback.

### Task 3.2: Confirm no scheduled work remains on Hermes

- [ ] **Step 1:** `docker exec hermes-agent hermes cron list` → only `daily-brief` + `cost-report` remain (both to be dropped). Confirm `vault-ingest` is gone (3.x) and pr-triage runs in Paperclip. **Step 2:** Document.

---

## Phase 4 — Retire Hermes services (one at a time)

**Files:** Modify `docker-compose.yml` (remove service blocks + `hermes-data` volume).

### Task 4.1: Remove `hermes-gateway`
- [ ] Remove the `hermes-gateway` service block. `docker compose config -q`. Commit + PR. On the Droplet after merge: `docker compose up -d --remove-orphans` (gateway stops; its only jobs were daily-brief/cost-report, intentionally dropped). Verify no errors for ~1 cycle.

### Task 4.2: Remove `inbox-watcher`
- [ ] Remove the `inbox-watcher` service block. `docker compose config -q`. Commit + PR. (inbox-triage dropped per spec — Claude on-demand replaces it.)

### Task 4.3: Remove `hermes-agent` + `hermes-data` volume
- [ ] Remove the `hermes-agent` service + the `hermes-data` named volume + the `agenticos-hermes` build-context references. `docker compose config -q`. Commit + PR. On the Droplet: `docker compose up -d --remove-orphans`; confirm the remaining stack (db/ollama/openviking/vault-server/paperclip-server) is healthy.

---

## Phase 5 — Delete code + infra + archive note

### Task 5.1: Delete Hermes packages
**Files:** Delete `packages/agenticos-hermes/`, `packages/hermes-client/`.
- [ ] Remove both dirs + any `pnpm-workspace`/root references. `pnpm install` (lockfile updates). `pnpm -w typecheck` + build green. Commit + PR.

### Task 5.2: Remove Hermes from cloud-init + infra scripts
**Files:** Modify `infra/cloud-init/droplet-bootstrap.yaml.tpl` (remove the hermes image build/usage, the `hermes-config` copy block, and the `register-cron-jobs` invocation); delete `infra/scripts/register-cron-jobs.sh`.
- [ ] Remove the blocks. Render-validate the template (`terraform templatefile` with test vars, per the cloud-init catch-up pattern). Confirm no `${...}` escaping breakage. `terraform fmt`. Commit + PR.

### Task 5.3: Document the Hermes Postgres archive
**Files:** Modify `docs/runbooks/` (or `infra/README.md`) — note that `tasks/sessions/calls/budget/vault_ingest_state` in the `agenticos` DB are a frozen read-only archive (no writers after retirement); query for pre-cutover cost history only.
- [ ] Add the note. Commit.

### Task 5.4: Final sweep
- [ ] `grep -rinE "hermes" --include=*.ts --include=*.tsx --include=*.yml --include=*.tpl . | grep -v node_modules | grep -v archive-note` → only intentional references (archive doc, ADR history) remain. `pnpm -w typecheck && pnpm -w build`. Commit any stragglers. Open the final PR.

---

## Self-review notes

- **Spec coverage:** §2 disposition → Phases 1 (repoint), 2 (vault_ingest), 4–5 (retire/delete), drops handled by not-porting + Phase 4 service removal. §4 dashboard → Tasks 1.1–1.6, 3.1. §5 sequencing → phase gates. §8 archive → Task 5.3. §6 cost-blindness → enforced by Task 2.1 keeping vault-ingest a deterministic job (no adapter/LLM). All acceptance criteria (§12) map to a task.
- **Daily-brief/cost-report/inbox-triage:** no port tasks (intentional drop). Their cron entries die with `hermes-gateway` (4.1) / `inbox-watcher` (4.2); their code dies with the package (5.1).
- **Type consistency:** the `Result<T>` pattern + `VaultFile`/`diff` signatures are defined once (1.1, 2.2) and consumed by name downstream.
