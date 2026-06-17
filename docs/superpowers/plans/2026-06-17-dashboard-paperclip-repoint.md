# Dashboard Paperclip Repoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the entire dashboard off the Hermes Task/Session/Call schema onto Paperclip's REST API — repoint 6 panel groups, add 4 Paperclip-native panels, retire 3 Hermes-only panels — all behind a `DASHBOARD_DATA_SOURCE` flag, flipped at the end.

**Architecture:** Extends the foundation (PR #180): one typed Paperclip client (`lib/paperclip/client.ts`), one `/api/*` route per data need branching on `dataSource()`, panels fetch their route. Build additive + flag-gated (default `hermes`), verify on a preview, flip the flag live. Hermes route branches are deleted later (retirement Phases 4-5), not here.

**Tech Stack:** Next.js (App Platform), TypeScript, vitest, TanStack Query, the existing `lib/paperclip/client.ts` + `app/api/{costs,runs,agent/health}` from #180.

## Global Constraints

- Spec: [docs/superpowers/specs/2026-06-17-dashboard-paperclip-repoint-design.md](../specs/2026-06-17-dashboard-paperclip-repoint-design.md).
- Architecture decision: this plan is authorized by the [ADR 0006 amendment (2026-06-17) — Dashboard kept + repointed](../../adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed). The dashboard is **kept and repointed**, not replaced by Paperclip's UI.
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
  - ~~`costByPeriod(...)` → `costs/by-period`~~ **DROPPED — Phase A.5 confirmed `costs/by-period` does not exist (deprecated 404 stub).** Do not add it. B1 burndown uses the capped per-day `costSummary` fan-out instead. *(A.5 already reconciled the real shapes for `Issue`/`Routine`/`OrgNode`/`Approval`/`ActivityItem` in `client.ts` — note `OrgNode` is a **recursive** `{id,name,role,status,reports[]}` tree, not flat.)*
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

## Phase A.5 — Capture real Paperclip response shapes (gate before Phase B)

**Why:** Phases B/C build ~13 route branches that map Paperclip responses → existing component shapes. Four shapes (`by-period`/cost bucketing, `org`, `approvals`, `issues`) are unverified, and the mocked-client tests prove the *mapper* (X→Y) but nothing about whether Paperclip actually returns X. A wrong shape discovered at the D2 preview gate (after 13 tasks) is a re-architecture, not a patch (e.g. if `costs/by-period` lacks server-side bucketing, B1 burndown becomes an N-per-day-`summary` fan-out — a different route, not a different mapping). Capturing real responses **once, up front** converts the test suite from theatre to real coverage and de-risks every downstream task.

### Task A0.5: Capture live Paperclip fixtures + confirm shapes

**Files:**
- Create: `apps/dashboard/lib/paperclip/__fixtures__/*.json` (one raw response per endpoint behind a panel group)
- Create: `apps/dashboard/lib/paperclip/__fixtures__/SHAPES.md` (per-endpoint: confirmed fields the panels consume, plus any field the panel wants that Paperclip does **not** provide → feeds the "real-data-or-`n/a`" decision in B/C)

- [ ] **Step 1:** Against the real Paperclip API (board key + company id from the 1Password item / `/tmp/pc-verify`, VPC or tunnel), `curl` each endpoint the repoint depends on: `costs/summary`, `costs/by-agent-model`, `costs/by-period?bucket=day` (**does it bucket server-side? this single answer decides B1's burndown route shape**), `heartbeat-runs`, `activity`, `agents`, `issues`, `routines`, `org`, `approvals`. Save each raw JSON to `__fixtures__/`.
- [ ] **Step 2:** For each, record in `SHAPES.md` which panel-consumed fields are present, and flag every **absent** field a panel currently shows (per-call tokens, per-run error text, "kind", run duration, `age`, etc.). Absent → that field is `n/a`/hidden in B/C, **never a fabricated zero/synthesized string** (council: observability tools must not display invented data as measured).
- [ ] **Step 3:** Promote the captured JSON into the B/C route tests as fixtures so the mocked client returns **real-shaped** data. Reconcile any client interface from A2 that guessed wrong (`CostPeriodPoint`/`Issue`/`Routine`/`OrgNode`/`Approval`).
- [ ] **Step 4:** Commit (`chore(dashboard): capture real Paperclip response fixtures + SHAPES.md`). **Gate:** Phase B does not start until `SHAPES.md` exists and B1's cost-bucketing question is answered.

> If the live API is unreachable at this point, this task still produces `SHAPES.md` from the vendored `vendor/paperclip/server/src` response builders (read the route handlers) — a verified-from-source shape is acceptable; a *guessed* shape is not.

---

## Phase B — Repoint clean-mapping panels (one task per panel group)

For every Phase B/C task: **read the component + its existing `/api/...` fetch first** to learn the exact consumed shape; build the route's `paperclip` branch to return that shape; gate the component's fetch URL (or its hook) on `dataSource()` only if it must change endpoints — prefer keeping the same URL and branching inside the route. Each task: failing route test (mocked client) → implement route branch → wire component if needed → typecheck → commit.

### Task B1: Cost panels (burndown / projection / today / KPI)

**Files:**
- Modify: `apps/dashboard/app/api/cost/burndown/route.ts`, `apps/dashboard/app/api/cost/projection/route.ts`, `apps/dashboard/app/api/cost/today/route.ts` (add a `dataSource()==="paperclip"` branch to each; keep the Hermes branch)
- Test: the colocated `*.test.ts` for each route
- Consumers (verify shapes): `components/observability/CostBurndownChart.tsx` (`BurndownResponse`), `CostProjectionPanel.tsx` (`CostProjectionData`), `lib/hooks/use-kpi-data.ts`

**Interfaces:**
- Consumes: `costSummary`, `costByAgentModel` (foundation), and **conditionally** `costByPeriod` (A2 — only if Phase A.5 confirms server-side bucketing; see below).

**Cost-series source (RESOLVED — Phase A.5 confirmed, see `__fixtures__/SHAPES.md`):**
- **Burndown** — A.5 confirmed `costs/by-period` **does not exist** (it's a deprecated stub that 404s). So burndown ← **per-day `costSummary` fan-out**, window-capped to N days (cap the loop; never fan out an unbounded range), fail-closed `503` if any day errors. `costByPeriod` is a **phantom — not used** (dropped from A2).
- **Cap / budget line** (both `BurndownResponse` target, `CostProjectionData.cap_usd`, KPI `cap_cents`) ← **`costSummary.budgetCents`** (already on the foundation client — no new endpoint). If no budget policy is configured, cap is `null`/absent → panels render spend without a cap line, **not** a fabricated cap.

- [ ] Step 1: For each route, failing test asserting the paperclip branch maps Paperclip cost data → the existing response interface (`BurndownResponse`/`CostProjectionData`/KPI today shape) and 503 on `{ok:false}`.
- [ ] Step 2: FAIL.
- [ ] Step 3: Implement each route's paperclip branch (burndown ← capped per-day `costSummary` fan-out [A.5: no by-period endpoint]; projection ← `costSummary` mtd + cap + days-remaining math; today ← today/yesterday/mtd `costSummary` ranges + `budgetCents` cap).
- [ ] Step 4: PASS + typecheck.
- [ ] Step 5: Commit.

### Task B2: Runs panels (RunsVista + LiveRunsPanel)

> **Re-scoped 2026-06-17 (review):** the runs view is **four** Hermes endpoints across two components, not the single `/api/runs` the original brief named. `/api/runs` (#180) supplies only the feed; it provides no time-bucketed event series and no aggregate tiles, so it cannot feed `RunsVista`. Per the plan's own rule (line 20: prefer branching **inside** the existing route), repoint each endpoint **in place** rather than swapping components to `/api/runs`. Build every `paperclip` branch from `heartbeatRuns()`, reusing #180's `HeartbeatRun → RunRecord` mapper. Split into B2a–B2d; each is its own failing-test → implement → typecheck → commit cycle.

**Shared mapping decisions (apply to all of B2):**
- **`kind` ← `invocationSource`** (values: `timer` / `assignment` / `automation` / `on_demand` / `manual`). `HeartbeatRun` has no Hermes "task-kind"; `invocationSource` is the inline, no-join, genuinely kind-like field. The provider/adapter dimension (claude / codex / ollama) is **not** the run `kind` — it stays in the cost-by-agent-model view (B5), not duplicated onto runs.
- **status mapping:** Paperclip run status → `running | done | failed` (the enum the chart/feed consume). Confirm the source status values in Phase A.5 `SHAPES.md` before writing the map; do not guess.
- Token fields stay zeroed and surfaced as `n/a` (Paperclip carries no per-call tokens — A.5-confirmed); do not render fabricated zeros as if measured.

**B2a — Live-runs feed.** Branch `app/api/agent/runs` (the endpoint `lib/hooks/use-run-feed.ts` actually hits — *not* `/api/tasks`) on `dataSource()`: paperclip → `heartbeatRuns()` mapped to the `{ runs }` shape the hook expects. Failing route test (mock client) → implement → typecheck → commit.

**B2b — RunsVista chart.** Branch `app/api/tasks/recent-events` on `dataSource()`: paperclip → recent `heartbeatRuns()` mapped to `RecentRunEvent { at, status, kind, id }[]`. Failing test → implement → commit.

**B2c — RunsVista tiles.** Branch `app/api/tasks/stats` on `dataSource()`: paperclip → `RunsStats { activeCount, failedToday, avgDurationSec, activeKinds }` derived from `heartbeatRuns()` (`activeKinds` = distinct `invocationSource` of currently-running). `avgDurationSec` from `startedAt`/`finishedAt`; if unavailable, `null` (the tile already handles null), not a fabricated value. Failing test → implement → commit.

**B2d — LiveRunsPanel poll.** Branch `app/api/tasks/active` on `dataSource()`: paperclip → `heartbeatRuns()` filtered to live statuses (queued/running), mapped to the panel's row shape. Failing test → implement → commit.

**B2e — Write actions (cancel/retry): OUT OF SCOPE — hide on the paperclip path.** `LiveRunsPanel` has a cancel button (`DELETE /api/tasks/:id`) and `RecentErrorsPanel` (B3) a retry (`POST /api/tasks/:id/retry`) — both Hermes endpoints that die at retirement. Spec §9 scopes the repoint **read-only**, so they must not stay wired to a corpse.

**Resolved 2026-06-17 (write-actions grill): hide both buttons when `dataSource()==="paperclip"`** (gate the button render, not just the fetch). Honors §9 and the [ADR 0006 amendment](../../adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed) ("dashboard is read-only against Paperclip"). The Hermes branch keeps the buttons unchanged until retirement. Asymmetry to record in the FR: **cancel has a native Paperclip endpoint** (`POST /api/heartbeat-runs/:runId/cancel`, [agents.ts:3405](../../../vendor/paperclip/server/src/routes/agents.ts:3405)) so it's a quick future wire; **retry has none** (retry is issue-level — `scheduledRetryRunId` — and needs design).

- [ ] Step 1: In `LiveRunsPanel.tsx` and `RecentErrorsPanel.tsx`, render the cancel/retry control only when `dataSource()!=="paperclip"`. Test both branches (button present under hermes, absent under paperclip). Step 2: typecheck. Step 3: Commit. Step 4: File the follow-up FR (below) and reference it in the commit body.
- [x] **Follow-up FR filed:** [FR: Dashboard run-control on Paperclip (cancel / retry)](https://app.asana.com/1/1213817682522376/project/1214851151154315/task/1215826306763708) (AgenticOS → Backlog, 2026-06-17) — restore cancel (wire to `POST /api/heartbeat-runs/:runId/cancel`) and design a run-retry path (no direct Paperclip endpoint; route through issue-level retry). Tracks the cutover capability gap.

### Task B3: RecentErrorsPanel

**Files:**
- Create: `apps/dashboard/app/api/runs/errors/route.ts` (paperclip: failed `heartbeat-runs`/`activity` → the `RecentErrorRow` shape; hermes branch: existing `/api/tasks` error rows) + test
- Modify: `components/observability/RecentErrorsPanel.tsx` to fetch the new route under the flag.

**Mapping decisions (consistent with B2):**
- **`kind` ← `invocationSource`** (same as B2 — not the Hermes task-kind).
- **`error` text:** Paperclip carries **no per-run error string** (A.5-confirmed; `livenessReason` is a *status* string like "stuck"/"waiting", not an error message). Source `error` from `livenessReason` only when it denotes a failure, else `null` → the panel shows the row without a fabricated message. **Do not synthesize an error string** (council: observability must not display invented data as measured).
- **Retry button: hidden on the paperclip path** (see B2e) — gate its render on `dataSource()!=="paperclip"`.

- [ ] Step 1: Failing route test (mock client): maps failed `heartbeat-runs` → `{id,kind,error,started_at}` rows (`kind`←invocationSource, `error`←failure-only livenessReason or `null`); 503 on failure. Step 2: FAIL. Step 3: Implement + hide the retry control under the flag. Step 4: PASS + typecheck. Step 5: Commit (+ wire panel).

### Task B4: ScheduledRunsPanel

> **Resolved 2026-06-17 (grill, option B):** the panel must show **routines + the statically-known plugin-job crons** (`vault-ingest`, `pr-triage`) — not routines-only. Those crons are the operator's actual scheduled work (vault-ingest is the "$0 North Star" job); dropping them from the schedule view at cutover is an observability regression the retirement is meant to avoid. Their schedules are statically declared in the plugin manifests, so hiding them is a choice, not a limitation.

**Files:**
- Modify: `apps/dashboard/app/api/tasks/scheduled/route.ts` (the endpoint the panel actually calls — branch in-place on `dataSource()`, per the line-20 rule) + test
- Modify: `components/observability/ScheduledRunsPanel.tsx` — hide the **"trigger now"** write button when `dataSource()==="paperclip"` (it `POST`s a dying Hermes endpoint; same read-only rule as B2e — covered by the run-control FR).

**Mapping (paperclip branch) → `{name, cron, last_run_label, next_in}[]`:**
- **Routines** ← `routines()` (one row per routine; cron/next-run from the routine).
- **Plugin-job crons** ← merge in the manifest-declared jobs (`vault-ingest` `0 * * * *`, `pr-triage` cron) by `jobKey` + schedule (static source: the plugin manifests).
- **Runtime fields** (`last_run_label`, `next_in`): **per Phase A.5** — real if `/instance/scheduler-heartbeats` (or another endpoint A.5 finds) exposes plugin-job last/next run; **else `—`/`n/a`** (no fabricated timestamps). The cron string + job name always render.

- [ ] Step 1: Failing route test: paperclip branch returns routines **+** the static plugin-job crons in the scheduled-job shape; runtime fields `—` when unavailable; 503 on `{ok:false}`. Step 2: FAIL. Step 3: Implement + hide the trigger button under the flag. Step 4: PASS + typecheck. Step 5: Commit.

### Task B5: Per-model spend (OpenAICodexPanel)

> **Resolved 2026-06-17 (grill, option A — reshape to real).** The current Hermes route (`app/api/cost/models/openai/route.ts`) is a **hardcoded stub** (`// TODO: wire to real OpenAI usage telemetry`, fake rows like `gpt-5-codex … age:"6m ago"`). The old `OpenAIModelUsage` shape `{name, role, calls, age, spend_usd}` is therefore **not a real contract** — `role`/`age` were invented and `calls` has no Paperclip source. So this task *reshapes* the panel to the real per-model data Paperclip has, rather than fabricating the missing fields. This is an allowed component change precisely because the prior shape was a stub.

**New `OpenAIModelUsage` shape** → `{ name, spend_usd, inputTokens, outputTokens, cachedInputTokens, calls? }`:
- `name ← model`, `spend_usd ← costCents/100`, token counts ← the real `inputTokens/outputTokens/cachedInputTokens` on `costByAgentModel` (provider-filtered to OpenAI/Codex, aggregated by model).
- **Drop `age` and `role`** (no honest source — were fabricated).
- `calls`: include **only if Phase A.5 finds a per-model call-count source** (e.g. a `cost_events` count); otherwise omit it (do not substitute tokens-as-calls or a placeholder).

**Files:**
- Modify: `apps/dashboard/app/api/cost/models/openai/route.ts` — paperclip branch ← `costByAgentModel` (provider-filtered, aggregated) → the reshaped row; hermes branch keeps returning its stub mapped into the reshaped fields (drop `age`/`role`), unchanged in spirit until D-phase deletion.
- Modify: `components/observability/OpenAICodexPanel.tsx` — render the reshaped fields (model · spend · tokens), remove the `{role} · {calls} calls · {age}` line; update `OpenAIModelUsage`.

- [ ] Step 1: Failing test mapping provider-filtered `costByAgentModel` → the reshaped row + 503 on `{ok:false}`. Step 2: FAIL. Step 3: Implement route branch + reshape the component. Step 4: PASS + typecheck. Step 5: Commit.

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
