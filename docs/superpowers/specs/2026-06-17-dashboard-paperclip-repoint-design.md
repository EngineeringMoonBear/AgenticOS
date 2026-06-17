# Dashboard Paperclip Repoint — Design

**Date:** 2026-06-17 (updated 2026-06-17 — council review + grill)
**Status:** Approved; implementation plan written ([plan](../plans/2026-06-17-dashboard-paperclip-repoint.md)). Authorized by the [ADR 0006 amendment (2026-06-17) — Dashboard kept + repointed](../../adr/0006-hermes-to-paperclip-runtime.md#amendment-2026-06-17--dashboard-kept--repointed): AgenticOS **keeps its bespoke Next.js "Vista" dashboard and repoints it** onto Paperclip's API — it is **not** replaced by Paperclip's own React/Vite UI.
**Author:** Josh + Claude
**Context:** Re-scoped out of the Hermes Retirement effort
([spec](2026-06-16-hermes-retirement-design.md)). During Phase 1 execution the
dashboard's Hermes coupling proved ~3x the plan's estimate (~10 endpoints across
~12 consumers), so the full repoint became its own effort. The foundation
(typed Paperclip API client + `/api/costs`, `/api/runs`, `/api/agent/health`
behind a `DASHBOARD_DATA_SOURCE` flag) shipped in PR #180.

---

## 1. Goal

Repoint the entire AgenticOS dashboard (Next.js on DO App Platform) off the
legacy Hermes `Task/Session/Call` Postgres schema onto Paperclip's REST API, so
that when Hermes is deleted (retirement Phases 4-5) no dashboard function is
lost. This is a **redesign around Paperclip's data model** (option B), not a 1:1
reproduction: panels that reflect Hermes-only concepts retire to a backlog;
Paperclip-native panels are added.

## 2. Architecture

Extend the foundation pattern (PR #180), unchanged:

- One typed Paperclip API read client (`lib/paperclip/client.ts`), board-key
  auth over the VPC, `Result<T>` returns, no retries, per-request timeout.
- One Next.js API route per dashboard data need (`app/api/<feature>/route.ts`).
  Each route branches on `dataSource()` (`lib/config/data-source.ts`,
  `DASHBOARD_DATA_SOURCE` env): the `paperclip` branch reads the client; any
  other value runs the existing Hermes path, byte-for-byte unchanged.
- No component reads Paperclip directly — all data flows through routes.
- Build incrementally behind the default-off flag; verify the whole view on a
  preview URL; flip `DASHBOARD_DATA_SOURCE=paperclip` live as the cutover.
- The Hermes route branches are deleted in the Hermes teardown (retirement
  Phases 4-5), not here.

The client gains read methods as panels need them (`issues`, `routines`, `org`,
`approvals`, `costByPeriod`, …) following the existing method shape.

**Shape-capture gate (Phase A.5, added 2026-06-17 after council review).** Before
building the ~13 route branches, capture **real** Paperclip responses for every
endpoint behind a panel group into test fixtures + a `SHAPES.md`, and confirm the
unverified shapes (`costs/by-period` bucketing, `org`, `approvals`, `issues`).
Mocked-client tests prove the *mapper* (X→Y) but nothing about whether Paperclip
returns X; capturing real shapes once, up front, converts the suite from theatre
to real coverage. (If the live API is unreachable, derive shapes from the
vendored `vendor/paperclip/server/src` response builders — verified-from-source
is acceptable, *guessed* is not.)

**Data-fidelity principle (no fabrication).** Where Paperclip lacks a field a
Hermes-era panel showed, render `n/a`/hide it — **never a fabricated zero or
synthesized string**. This is an *observability* surface; invented values
displayed as measured are worse than blank. Confirmed gaps: no per-call token
counts (aggregate only); no per-run error text (`livenessReason` is a status
string); no Hermes "kind" taxonomy. The run **`kind`** maps to Paperclip's
inline `invocationSource` (`timer`/`assignment`/`automation`/`on_demand`/
`manual`); the provider/adapter dimension (claude/codex/opencode) stays in the
cost-by-agent-model view, not duplicated onto runs.

## 3. Panel disposition

### 3.1 Repoint (clean Paperclip map)

| Panel(s) | Paperclip source |
| --- | --- |
| CostVista, CostBurndownChart, CostProjectionPanel, KPI cost tiles | `costs/summary` (+ cap line ← `summary.budgetCents`); burndown series ← `costs/by-period?bucket=day` **iff A.5 confirms server-side bucketing, else a window-capped per-day `costs/summary` fan-out** |
| RunsVista, LiveRunsPanel | `heartbeat-runs` mapped in-place across **four** existing routes (the runs view is not a single endpoint): feed (`/api/agent/runs`), chart events (`/api/tasks/recent-events`), stat tiles (`/api/tasks/stats`), live poll (`/api/tasks/active`). `kind ← invocationSource`. |
| AgentStatusChip / agent health | Done in #180 (`/api/agent/health` synthesis) |
| RecentErrorsPanel | failed `heartbeat-runs` → rows; `error` ← failure-only `livenessReason` or `null` (no fabricated message); `kind ← invocationSource` |
| ScheduledRunsPanel | `GET /companies/:id/routines` (see §5 constraint on plugin-job crons) |
| OpenAICodexPanel (per-model spend) | `GET /companies/:id/costs/by-agent-model` |

### 3.2 Add (Paperclip-native, new)

| Panel | Paperclip source |
| --- | --- |
| Agents roster + status | `GET /companies/:id/agents` (adapter, status, last activity) |
| Issues / work queue | `GET /companies/:id/issues` (status, assignee, priority) |
| Routines | `GET /companies/:id/routines` (+ next-run/triggers) |
| Org chart / approvals | `GET /companies/:id/org`, `GET /companies/:id/approvals` |

### 3.3 Retire to backlog (Hermes-only concepts)

These reflect Hermes's data model and have no honest Paperclip source; they
retire with Hermes and become feature requests (§6):

| Panel | Why retired |
| --- | --- |
| RateLimitsPanel | provider API rate-limit caps — a Hermes routing concept. Paperclip has *budget* caps, not rate limits. |
| QueueDepthPanel | counts by Hermes task-kind (daily-brief/etc. — the kinds being dropped). |
| OllamaPanel | local-SLM per-model `calls_today`. Paperclip agents use claude/codex/opencode adapters, not Ollama routing. |

## 4. Components & data flow

Each repointed/new panel keeps its existing props/shape where one exists; the
route maps Paperclip's response into that shape (the foundation's `/api/runs`
already does this for the `RunRecord` shape). New panels (agents/issues/
routines/org) get small presentational components following the existing
`components/observability/*` patterns, fed by a matching `/api/*` route + a
TanStack `useQuery` hook (the repo's established data-fetch pattern).

## 5. Constraints to verify during planning

- **Cost time-series.** Burndown/projection need a per-day cost series. **Resolved
  via the Phase A.5 shape-capture gate:** if `costs/by-period?bucket=day` buckets
  server-side, use it (one call); if not, the route builds the series from a
  **window-capped per-day `costs/summary` fan-out** (cap the loop; fail-closed
  `503` if any day errors). The budget/cap line comes from `summary.budgetCents`
  (already on the foundation client); if no budget policy exists, the cap line is
  omitted, not faked.
- **Scheduled plugin-job crons.** Paperclip's plugin-job scheduler is
  host-internal; the public API exposes `routines`, not plugin-job crons
  (pr-triage, vault-ingest). ScheduledRunsPanel will show routines; surfacing
  plugin-job schedules may require a new endpoint or is deferred (the panel
  honestly shows what the API exposes).

## 6. Retired panels → backlog feature requests

Tracked as Asana feature requests (re-add on Paperclip once the data exists):

- **Rate/throughput view** — rebuild against Paperclip budget-policy windows or
  adapter throughput once exposed.
- **Queue depth** — rebuild from Paperclip `live-runs` (queued/running counts)
  rather than Hermes task-kinds.
- **Local-model (Ollama) usage** — an embeddings/SLM usage panel if/when local
  models are surfaced (Ollama still runs for OpenViking embeddings).

## 7. Error handling

Every route returns `503 {error}` when the client returns `{ok:false}` or
config is missing (foundation contract). Panels render their existing
loading/empty/error states. Agent-health-style synthesis (combining calls)
fails closed to a degraded/empty state, never a blank crash.

## 8. Testing

- Each route: vitest with a mocked Paperclip client (foundation pattern) —
  assert the response shape the panel consumes + the 503 path. New-panel
  components get the repo's standard component tests.
- Integration gate: a preview deploy with `DASHBOARD_DATA_SOURCE=paperclip`
  renders every panel against live Paperclip data before the live flip.
- No change to current behavior until the flag flips (all work is additive +
  flag-gated).

## 9. Out of scope (YAGNI)

- Re-adding the three retired panels (backlog FRs §6).
- Deleting the Hermes route branches (happens in retirement Phases 4-5).
- Any write actions to Paperclip from the dashboard — read-only repoint. The
  existing run-control buttons (LiveRunsPanel **cancel**, RecentErrorsPanel
  **retry**) are **hidden when `dataSource()==="paperclip"`** (they call Hermes
  endpoints that die at retirement) and tracked for re-add as a backlog FR:
  *Dashboard run-control on Paperclip* (cancel has a native endpoint
  `POST /api/heartbeat-runs/:runId/cancel`; retry is issue-level and needs
  design).

## 10. Acceptance criteria

- Every §3.1 panel renders from Paperclip with no Hermes dependency; the four
  §3.2 panels exist and render real Paperclip data.
- The three §3.3 panels are removed from the view and filed as backlog FRs.
- `DASHBOARD_DATA_SOURCE=paperclip` makes the whole dashboard Hermes-free;
  default/unset still runs Hermes (until teardown).
- All routes have mocked-client tests; the preview gate passes before cutover.
- `pnpm -w typecheck` + build stay green; no current behavior changes pre-flip.
