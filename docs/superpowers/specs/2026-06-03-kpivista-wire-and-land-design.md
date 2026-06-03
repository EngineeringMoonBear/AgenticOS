# KpiVista — Wire to Real Data & Land — Design Spec

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — pending spec review → implementation plan
**Target:** Mount the persistent KPI banner in the dashboard shell, backed by
real data on all four tiles (no stub values, no fabricated deltas).

## Context

The `KpiVista` banner was built during the v2 UI work but never committed or
mounted. It currently lives as untracked WIP. Reading the code revealed:

- `useKpiData` is a **pure stub** — all four readings are hardcoded mockup
  values (`todaySpend {cents:241, deltaPct:-18}`, `activeRuns {count:3,delta:1}`,
  `vaultFiles {count:2847, hourly:5}`, `memoriesIndexed {count:1204}`) behind a
  `TODO(v2): wire these to real endpoints` comment.
- The banner's docstring says it "mounts once in the root layout and persists
  across /runs, /cost, /health, /memory."
- `SharedHeader.tsx` already removed its status chips ("those moved to
  KpiVista"), so mounting KpiVista needs no de-dup there.
- It is badged 🚧 in `docs/information-architecture.md` (§1) as
  "untracked/not yet landed."

Two locked decisions from brainstorming:

1. **Wire to real data, then land** — mounting a persistent banner of fabricated
   numbers on every tab would violate the dashboard's honesty principle. All
   four tiles must read live data.
2. **Full backing for the deltas/sublabels** — build the data behind the
   mockup's delta badges (−X% vs yesterday, +N runs) and sublabels, not just the
   primary values.

**Key enabling discovery:** the `tasks` table records both `started_at` *and*
`ended_at` (migration `0001_initial_telemetry.sql`), and `cost_cents` per task.
This means "full backing" requires **no new sample-history table and no
sampler** — point-in-time run counts reconstruct from `ended_at` windows, and
`yesterday_cents` is a date-bounded `SUM`. Event-sourced timestamps replace
periodic sampling.

## Goal

Replace the `useKpiData` stub with real fetches, build the small amount of
server-side backing the deltas need (all derivable from existing tables), mount
`KpiVista` in the root layout, and land it with honest degraded states — while
leaving the orphaned Bucket 2 WIP and gitignored Finder duplicates uncommitted.

## Architecture

`KpiVista` (client) → `useKpiData` (one TanStack query, `staleTime: 30s`) →
fetches four endpoints in parallel and assembles the `KpiData` shape. Each tile
degrades **independently**: if its source fetch fails, that tile renders `—`
(and its delta/sublabel is omitted) while the others still show real data.

### Data sources (all backed by existing services)

| Tile | Primary value | Source | Delta / sublabel backing |
|------|---------------|--------|--------------------------|
| today's spend | `summary.today_cents` | `/api/cost/today` (exists) | **deltaPct** vs `summary.yesterday_cents` (new field); **sublabel** `cap_cents` + `mtd_cents` (exist) |
| active runs | Σ `rows[].count` (queued+running) | `/api/tasks/queue-depth` (in WIP) | **delta** = now − in-flight-1h-ago (new `asOf` field, `ended_at` window); **sublabel** = distinct running `kind`s |
| vault files | `pageCount` | `/api/vault/stats` (exists, proxies vault-server `/stats`) | **hourly** = files added by the latest `vault-ingest` task within the last hour (from its `metadata`); else 0 |
| memories indexed | total | **new** `/api/memory/stats` → `vikingStatsMemories()` → OpenViking `/api/v1/stats/memories` | **sublabel** = per-category counts via `vikingStatsMemories(category)` |

### Server-side changes (minimal, derive-don't-sample)

1. **`lib/cost/db.ts` — add `yesterday_cents` to `CostSummary`.**
   `getCostSummary()` adds one date-bounded aggregate:
   `SELECT COALESCE(SUM(cost_cents),0) FROM tasks WHERE started_at::date = (CURRENT_DATE - 1)`.
   Add `yesterday_cents: number` to the `CostSummary` interface in
   `lib/cost/types.ts`. The `/api/cost/today` response already returns
   `{ summary, tasks }`, so no route change needed.

2. **`/api/tasks/queue-depth` — add point-in-time `asOf` count.**
   Extend the route to also compute the in-flight count one hour ago:
   `SELECT COUNT(*) FROM tasks WHERE started_at <= now() - interval '1 hour' AND (ended_at IS NULL OR ended_at > now() - interval '1 hour')`.
   Return `{ rows, asOf1hCount }`. Current-in-flight total = sum of `rows[].count`;
   delta = total − `asOf1hCount`. (Backward compatible — `rows` unchanged.)

3. **New `/api/memory/stats` route.** Calls `vikingStatsMemories()` (and, if
   cheap, per-category) from `lib/api/viking.ts`; returns
   `{ total: number, byCategory?: Record<string,number> }`. Returns `502`/`null`
   on Viking unreachable so the tile degrades to `—` rather than 500-ing the
   whole banner. (Distinct from the orphaned 501 `/api/memory/sessions` stub,
   which is **not** part of this work.)

4. **`/api/vault/stats`** — already exists; no change. `store.stats()` provides
   `pageCount`.

### Client changes

5. **`lib/hooks/use-kpi-data.ts`** — replace the stub `queryFn` with four
   parallel fetches (`Promise.allSettled` so one failure doesn't sink the
   others), mapping each response into the existing `KpiData` shape extended
   with optional sublabel fields. Keep `staleTime: 30_000`. Each settled
   rejection → that field becomes `null`/`—`.

6. **`components/shell/KpiVista.tsx`** — replace hardcoded sublabels with the
   real derived values; render delta badges only when their backing value is
   present (omit, don't fake, when a source is degraded). `EkgSweep`,
   formatting helpers, and the gold-horizon chrome are unchanged.

7. **`app/layout.tsx`** — mount `<KpiVista />` between `<SharedHeader />` and
   `{children}` (matching the docstring). It is a client component with its own
   query; the server layout just renders it. Must render with no dependency on
   any removed/orphaned nav.

### Out of scope (Bucket 2 — left uncommitted or deleted, NOT landed)

- `lib/vault/hooks/use-promote-inbox.ts` — imported only by gitignored
  `* 2.tsx` Finder duplicates; the real `InboxQueue` uses `PromoteDrawer`.
- `lib/hooks/use-memory-sessions.ts`, `lib/hooks/use-memory-peer-rep.ts` —
  imported nowhere.
- `app/api/memory/sessions/route.ts`, `app/api/memory/peer-rep/route.ts` — 501
  Viking-premise stubs, unused.
- The 7 gitignored `components/memory/* 2.tsx` Finder duplicates — stay
  gitignored (optionally `rm` from disk as housekeeping, but not tracked).

These are deleted from disk as cleanup **or** simply not staged. They must not
enter the commit.

## Error / degraded handling

- Banner never throws: `useKpiData` uses `Promise.allSettled`; the component
  renders `—` for any tile whose source rejected.
- A degraded tile shows the primary `—` and **omits** its delta badge and
  data-derived sublabel (no fabricated fallback text).
- `/api/memory/stats` returns a non-2xx (not a throw) when Viking is down, so
  the memories tile degrades alone.
- The "Live · as of HH:MM:SS" indicator reflects the query's last successful
  fetch time, not wall-clock, so it doesn't imply freshness during an outage.

## Testing

- **`use-kpi-data.test.ts`** (new/updated): mock the four fetches; assert the
  assembled `KpiData`; assert independent degradation (one rejects → that field
  null, others intact).
- **`KpiVista.test.tsx`** (exists, update): renders four tiles with real-ish
  data; renders `—` and omits delta when a field is null; loading state shows
  em-dash chrome.
- **`QueueDepthPanel.test.tsx`** (exists): keep; update if the route shape gains
  `asOf1hCount`.
- **Cost summary test** (`lib/cost/db.test.ts`): assert `yesterday_cents` is
  computed and `deltaPct` math is correct (incl. yesterday=0 guard → no badge).
- **`/api/memory/stats` route test**: 200 with total on Viking success; non-2xx
  (no throw) on Viking failure.
- Mount smoke: an existing shell/layout test (or a new one) asserts `KpiVista`
  renders on a representative tab without crashing.

## Non-goals (YAGNI)

- No new `task_queue_samples` table or sampler cron — deltas derive from
  `started_at`/`ended_at` and `cost_cents`.
- No redesign of the banner's visual chrome — the mockup
  (`docs/design/v2-ui-mockup.html`) is the approved look.
- Not wiring the orphaned `/api/memory/{sessions,peer-rep}` routes.
- Not changing `SharedHeader` (chips already removed).

## Acceptance criteria

1. All four KpiVista tiles display **real** data from live endpoints; no
   hardcoded values remain in `use-kpi-data.ts`.
2. Spend delta (vs `yesterday_cents`) and active-runs delta (vs in-flight-1h-ago
   via `ended_at`) are real; both omit gracefully when their basis is absent
   (e.g. yesterday=0).
3. Sublabels are derived from real data (cap/MTD, running kinds, memory
   categories, vault hourly) — no hardcoded mockup strings.
4. `KpiVista` mounts in `app/layout.tsx` and persists across Runs/Cost/Health/
   Memory; each tile degrades to `—` independently on source failure; the banner
   never crashes the shell.
5. New `/api/memory/stats` returns Viking memory counts and degrades (non-throw)
   when Viking is unreachable.
6. Bucket 2 orphans and `* 2.tsx` duplicates are **not** in the commit.
7. `docs/information-architecture.md` §1 KpiVista badge flips 🚧 → ✅ (with
   accurate data-source notes).
8. Lint, Typecheck, Unit, Build, Pytest, Playwright, markdownlint all green.
