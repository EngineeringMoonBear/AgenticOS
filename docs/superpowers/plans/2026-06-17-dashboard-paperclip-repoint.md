# Dashboard Paperclip Repoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the entire dashboard off the Hermes Task/Session/Call schema onto Paperclip's REST API — repoint 6 panel groups, add 4 Paperclip-native panels, retire 3 Hermes-only panels — all behind a `DASHBOARD_DATA_SOURCE` flag, flipped at the end.

**Architecture:** Extends the foundation (PR #180): one typed Paperclip client (`lib/paperclip/client.ts`), one `/api/*` route per data need branching on `dataSource()`, panels fetch their route. Build additive + flag-gated (default `hermes`), verify on a preview, flip the flag live. Hermes route branches are deleted later (retirement Phases 4-5), not here.

**Tech Stack:** Next.js (App Platform), TypeScript, vitest, TanStack Query, the existing `lib/paperclip/client.ts` + `app/api/{costs,runs,agent/health}` from #180.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-17-dashboard-paperclip-repoint-design.md](../specs/2026-06-17-dashboard-paperclip-repoint-design.md).
- Read Paperclip via the REST API client only — never the `paperclip` DB directly.
- Every route returns `503 {error}` on client `{ok:false}` or missing config; never throws.
- All work is **additive + flag-gated** — `dataSource()!=="paperclip"` must run the existing Hermes path byte-for-byte unchanged. No current behavior changes until the final flip.
- Board-key auth; config from env `PAPERCLIP_API_URL` / `PAPERCLIP_BOARD_KEY` / `PAPERCLIP_COMPANY_ID`.
- vitest with a mocked Paperclip client (foundation pattern); behavioral assertions, not truthiness.
- Commits: `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit`, message ends `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never push main; branch + PR.
- Match each panel's existing consumed response shape (read the component before writing its route).

---

## Phase A — Shared flag + client extension

### Task A1: `dataSource()` helper + refactor health route

**Files:**
- Create: `apps/dashboard/lib/config/data-source.ts`
- Create: `apps/dashboard/lib/config/data-source.test.ts`
- Modify: `apps/dashboard/app/api/agent/health/route.ts` (replace the inline `process.env.DASHBOARD_DATA_SOURCE === "paperclip"` check with the helper)

**Interfaces:**
- Produces: `export function dataSource(): "hermes" | "paperclip"` — returns `"paperclip"` iff `process.env.DASHBOARD_DATA_SOURCE === "paperclip"`, else `"hermes"`.

- [ ] **Step 1:** Test: `dataSource()` returns `"hermes"` when env unset/other, `"paperclip"` when set. (Set/restore `process.env.DASHBOARD_DATA_SOURCE` per case.)
- [ ] **Step 2:** Run `pnpm --filter @agenticos/dashboard test data-source` → FAIL.
- [ ] **Step 3:** Implement the one-function helper.
- [ ] **Step 4:** Refactor the health route to `import { dataSource }` and branch on `dataSource() === "paperclip"` (behavior identical). Run the health route test → still PASS.
- [ ] **Step 5:** Commit.

### Task A2: Extend the Paperclip client with new read methods

**Files:**
- Modify: `apps/dashboard/lib/paperclip/client.ts`
- Modify: `apps/dashboard/lib/paperclip/client.test.ts`

**Interfaces:**
- Produces (add to `PaperclipClient`, mirroring existing method/`Result<T>` style; read the §5 spec note re: cost time-series):
  - `costByPeriod(params: { from?: string; to?: string; bucket?: "day" }): Promise<Result<CostPeriodPoint[]>>` → `GET /companies/:id/costs/by-period?from=&to=&bucket=` (if the API lacks bucketing, document it and fetch `costSummary` per-day in the route instead — decide in this task by checking the live API shape via the spec/`/tmp/pc-verify` if available; default to `by-period`).
  - `issues(params: { status?: string; limit?: number }): Promise<Result<Issue[]>>` → `GET /companies/:id/issues`
  - `routines(): Promise<Result<Routine[]>>` → `GET /companies/:id/routines`
  - `org(): Promise<Result<OrgNode[]>>` → `GET /companies/:id/org`
  - `approvals(params: { status?: string }): Promise<Result<Approval[]>>` → `GET /companies/:id/approvals`
  - (`agents()`, `costByAgentModel()`, `heartbeatRuns()`, `activity()`, `costSummary()` already exist.)
  - Define minimal exported interfaces (`CostPeriodPoint`, `Issue`, `Routine`, `OrgNode`, `Approval`) from the documented Paperclip response fields — only the fields panels consume.

- [ ] **Step 1:** Tests (mock fetch) per new method: correct path, bearer header, parse, non-2xx → `{ok:false}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the methods + interfaces (reuse the existing `buildUrl`/`fetchJson` helpers).
- [ ] **Step 4:** Run → PASS; `pnpm --filter @agenticos/dashboard typecheck`.
- [ ] **Step 5:** Commit.

---

## Phase B — Repoint clean-mapping panels (one task per panel group)

For every Phase B/C task: **read the component + its existing `/api/...` fetch first** to learn the exact consumed shape; build the route's `paperclip` branch to return that shape; gate the component's fetch URL (or its hook) on `dataSource()` only if it must change endpoints — prefer keeping the same URL and branching inside the route. Each task: failing route test (mocked client) → implement route branch → wire component if needed → typecheck → commit.

### Task B1: Cost panels (burndown / projection / today / KPI)

**Files:**
- Modify: `apps/dashboard/app/api/cost/burndown/route.ts`, `apps/dashboard/app/api/cost/projection/route.ts`, `apps/dashboard/app/api/cost/today/route.ts` (add a `dataSource()==="paperclip"` branch to each; keep the Hermes branch)
- Test: the colocated `*.test.ts` for each route
- Consumers (verify shapes): `components/observability/CostBurndownChart.tsx` (`BurndownResponse`), `CostProjectionPanel.tsx` (`CostProjectionData`), `lib/hooks/use-kpi-data.ts`

**Interfaces:**
- Consumes: `costByPeriod`, `costSummary`, `costByAgentModel` (A2).

- [ ] Step 1: For each route, failing test asserting the paperclip branch maps Paperclip cost data → the existing response interface (`BurndownResponse`/`CostProjectionData`/KPI today shape) and 503 on `{ok:false}`.
- [ ] Step 2: FAIL.
- [ ] Step 3: Implement each route's paperclip branch (burndown ← `costByPeriod` daily series; projection ← `costSummary` mtd + days-remaining math; today ← `costSummary` for the day).
- [ ] Step 4: PASS + typecheck.
- [ ] Step 5: Commit.

### Task B2: Runs panels (RunsVista + LiveRunsPanel)

**Files:**
- Modify: `apps/dashboard/components/shell/RunsVista.tsx`, `apps/dashboard/components/observability/LiveRunsPanel.tsx` (and/or `lib/hooks/use-run-feed.ts`) to fetch `/api/runs` (the #180 route) when `dataSource()==="paperclip"`, else the existing `/api/tasks`.
- Test: `lib/hooks/use-run-feed.test.ts` (or the component tests) covering both branches.

**Interfaces:**
- Consumes: `/api/runs` (foundation) → `{ runs: RunRecord[], live: RunRecord[] }`.

- [ ] Step 1: Failing test: with the flag on, the hook/components fetch `/api/runs` and render the `RunRecord[]`/`live` data; with it off, `/api/tasks` (existing).
- [ ] Step 2: FAIL. Step 3: Implement the flag branch in the hook. Step 4: PASS + typecheck. Step 5: Commit.

### Task B3: RecentErrorsPanel

**Files:**
- Create: `apps/dashboard/app/api/runs/errors/route.ts` (paperclip: failed `heartbeat-runs`/`activity` → the `RecentErrorRow` shape; hermes branch: existing `/api/tasks` error rows) + test
- Modify: `components/observability/RecentErrorsPanel.tsx` to fetch the new route under the flag.

- [ ] Step 1: Failing route test (mock client): maps failed runs → `{id,kind,error,started_at}` rows; 503 on failure. Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit (+ wire panel).

### Task B4: ScheduledRunsPanel

**Files:**
- Create: `apps/dashboard/app/api/routines/route.ts` (paperclip: `routines()` → `{name,cron,last_run_label,next_in}` shape) + test
- Modify: `components/observability/ScheduledRunsPanel.tsx` to fetch it under the flag.

Note (spec §5): this shows **routines**, not plugin-job crons (pr-triage/vault-ingest). Add a code comment + the panel's empty-state copy reflecting that; surfacing plugin-job crons is a deferred follow-up.

- [ ] Step 1: Failing route test mapping routines → the scheduled-job shape. Step 2: FAIL. Step 3: Implement + comment. Step 4: PASS. Step 5: Commit.

### Task B5: Per-model spend (OpenAICodexPanel)

**Files:**
- Modify: `apps/dashboard/app/api/cost/models/openai/route.ts` (paperclip branch ← `costByAgentModel` filtered to provider) + test
- Verify consumer: `components/observability/OpenAICodexPanel.tsx` (`OpenAIModelUsage`).

- [ ] Step 1: Failing test mapping `costByAgentModel` → `{name,role,calls,age,spend_usd}` (set `age` to a sensible placeholder if Paperclip lacks it — document). Step 2: FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit.

---

## Phase C — New Paperclip-native panels

Each: a `/api/*` route (paperclip branch returns the panel's shape; hermes branch returns empty/`503` since these are new — they simply render empty pre-flip), a TanStack `useQuery` hook, and a presentational component following `components/observability/*` patterns. Register each panel in the observability view (the same place the retired ones are removed in D1 — coordinate).

### Task C1: Agents roster panel

**Files:** Create `app/api/agents/route.ts` (+test), `lib/hooks/use-agents.ts`, `components/observability/AgentsPanel.tsx` (+test). Consumes `agents()` (existing client method).
- Route maps `Agent[]` → `{ id, name, adapter, status, lastActivityAt }[]`. Panel renders name + adapter + a status chip + relative last-activity. TDD route first, then component.

### Task C2: Issues / work-queue panel

**Files:** Create `app/api/issues/route.ts` (+test), `lib/hooks/use-issues.ts`, `components/observability/IssuesPanel.tsx` (+test). Consumes `issues()` (A2).
- Route maps `Issue[]` → `{ id, title, status, assignee, priority }[]`. Panel groups by status. TDD route → component.

### Task C3: Routines panel

**Files:** Create `app/api/routines/list/route.ts` (or reuse B4's `/api/routines` — if B4 already exposes routines, this panel consumes the same route; do NOT duplicate), `lib/hooks/use-routines.ts`, `components/observability/RoutinesPanel.tsx` (+test).
- If B4's route already returns routines in the needed shape, this task is component-only (hook + panel) over that route. Otherwise add fields. Avoid a second routines route.

### Task C4: Org + approvals panel

**Files:** Create `app/api/org/route.ts` + `app/api/approvals/route.ts` (+tests), `lib/hooks/use-org.ts` + `use-approvals.ts`, `components/observability/OrgPanel.tsx` (+test). Consumes `org()` + `approvals()` (A2).
- OrgPanel renders the company tree; an Approvals subsection lists pending approvals. TDD routes → component.

---

## Phase D — Retire + cutover

### Task D1: Remove the 3 Hermes-only panels

**Files:**
- Delete: `components/observability/RateLimitsPanel.tsx`, `QueueDepthPanel.tsx` (+ the stray `QueueDepthPanel 2.tsx`), `OllamaPanel.tsx` (+ their tests)
- Modify: the observability view/layout that renders them (remove imports + placements; add the Phase C panels in their place)
- Delete: the now-orphaned `app/api/cost/rate/route.ts` and `app/api/cost/models/ollama/route.ts` **only if** nothing else references them (grep first).

- [ ] Step 1: Grep for each panel + route to confirm no other references. Step 2: Remove panels + their tests + view placements. Step 3: Wire the Phase C panels into the vacated layout slots. Step 4: `pnpm --filter @agenticos/dashboard test` + typecheck green. Step 5: Commit. (Backlog FRs already filed in Asana — reference them in the commit body.)

### Task D2: Env + App Platform wiring + preview gate

**Files:**
- Modify: `apps/dashboard/lib/config/schema.ts` (the `PAPERCLIP_*` vars already added in #180 — confirm; add nothing new unless missing)
- Modify: `infra/terraform/app-platform.tf` (ensure `PAPERCLIP_API_URL`/`PAPERCLIP_BOARD_KEY`/`PAPERCLIP_COMPANY_ID` are set on the dashboard service; board key as a secret var like `openviking_root_api_key`)

- [ ] Step 1: Confirm/extend the env schema + `app-platform.tf`. `terraform fmt`. Step 2: Commit. Step 3 (manual gate): deploy the branch to a preview, set `DASHBOARD_DATA_SOURCE=paperclip`, verify **every** panel (Phase B repointed + Phase C new) renders against live Paperclip data with Hermes still live. This is the acceptance gate before the live flip.

### Task D3: Cutover

**Files:** Modify `infra/terraform/app-platform.tf` — set `DASHBOARD_DATA_SOURCE=paperclip` on the live dashboard.

- [ ] Step 1: Confirm D2 preview gate passed. Step 2: Set the var, `terraform fmt`, commit, PR, apply. Step 3: Verify the live dashboard is Hermes-free. (Hermes route branches remain in code, dormant, until retirement Phase 4-5 deletes them.)

---

## Self-review notes

- **Spec coverage:** §3.1 repoint → B1-B5 + B2(runs)+health(done #180); §3.2 new panels → C1-C4; §3.3 retire → D1 (+ Asana FRs filed); §2 flag/architecture → A1; cutover → D2/D3; §5 constraints → A2 (cost time-series) + B4 (plugin-job crons). All acceptance criteria (§10) map to a task.
- **Deferred-from-foundation:** the `dataSource()` helper (was Phase-1 Task 1.5) is A1; the runs panels (foundation built `/api/runs` but didn't wire components) are B2.
- **Type consistency:** new client methods/interfaces defined once in A2 and consumed by name in B/C. Routine routes deduped (B4 owns `/api/routines`; C3 reuses it).
- **No-duplicate guard:** C3 explicitly avoids a second routines route.
