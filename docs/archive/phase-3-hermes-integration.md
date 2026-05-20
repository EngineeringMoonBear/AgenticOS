# Phase 3 — Hermes Integration: Design

**Status**: Proposed (2026-05-19)
**Owner**: AgenticOS — single-developer (Josh)
**Supersedes**: Phase 2 fixture-backed Observability RunCard stubs (see `docs/plans/phase-2-design.md`)
**Predecessors required**: Phase 2 Vault + Memory (PR #[TBD], merged) — Phase 3 reuses `@agenticos/vault-core` types and the `/api/vault/*` + `/api/lint` + `/api/taxonomy` routes as MCP targets.

---

## 1. Goals

Phase 3 connects AgenticOS to a live Hermes daemon, ships a real Curator skill, and adds rate-limit observability. By the end of Phase 3:

- The Observability run feed consumes real Hermes run data via SSE and JSON routes rather than fixture stubs.
- A persistent `HermesClient` package wraps the Hermes HTTP + SSE API behind a typed interface.
- AgenticOS owns cron schedules in `~/.agenticos/cron.json`; Hermes executes them.
- A Curator skill runs nightly at 03:00 local time, processes inbox items > 7 days old, and writes only `vault/wiki/_meta/curator-log.md`.
- A Hermes-to-vault MCP server on port 7610 lets Hermes call `/api/vault/*` and related routes without direct filesystem access.
- Staleness detection surfaces stale runs in the UI with a gold lane stripe and "Cancel & restart" affordance.
- Anthropic rate-limit headers are passively captured and surfaced in a three-view Observability sidebar panel.

**Non-goals (explicitly deferred)**:

- `auto-cancel-stale` toggle — deferred to Phase 6 polish.
- `launchd` / `systemd` daemon supervision — deferred to Phase 6. AgenticOS detects the daemon but does not manage its lifecycle.
- Skill abstraction (`SkillRunner` interface, YAML-defined skills) — deferred to Phase 4, which will have two concrete examples (Curator + first Sandcastle skill) to abstract from.
- SQLite or persistent run history index — deferred; Phase 3 reads from Hermes in-memory state.
- Mobile-specific Observability improvements — read-only mobile view is unchanged.

---

## 2. Resolved Decisions

All 11 decisions were locked in during the 2026-05-18 brainstorming session. No design questions remain open.

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Hermes integration model | Persistent daemon + HTTP on `127.0.0.1:7600` | Durable connection; no subprocess management; daemon survives app restarts |
| 2 | Cron / schedule ownership | AgenticOS owns schedules (`~/.agenticos/cron.json`); Hermes is executor | Keeps schedule UI and persistence in the product layer; Hermes is a dumb executor |
| 3 | Phase 3 scope | Infrastructure + one real Curator skill | Validates the full stack without over-engineering; Phase 4 adds a Sandcastle skill |
| 4 | Skill abstraction | Hardcoded TypeScript (`lib/skills/curator.ts`) in Phase 3 | Premature abstraction avoided; Phase 4 has two examples to abstract from |
| 5 | Daemon supervision | Not supervised by AgenticOS; detect via `/health` ping | User controls `hermes serve` lifecycle; AgenticOS surfaces up/down status only |
| 6 | Vault writes from Hermes | Via MCP-to-AgenticOS server at `127.0.0.1:7610` | No direct FS writes from Hermes; all mutations flow through validated API routes |
| 7 | Auth between Hermes ↔ AgenticOS | None | Loopback binding + same OS user is the trust boundary; no added complexity |
| 8 | Routes — fold or split | 11 separate routes | SSE and JSON have different lifecycles; folding adds mux complexity |
| 9 | Scheduler needs AgenticOS running | Accept the constraint | launchd integration is polish, not infrastructure; deferred to Phase 6 |
| 10 | Staleness detection | Per-skill threshold; surface in UI; auto-cancel deferred | Gives visibility without automated intervention before Phase 6 |
| 11 | Rate-limit observability | Include in Phase 3 (passive header capture; 24h sparkline; projection) | Free signal from every response header; high value for scheduling decisions |

---

## 3. Architecture

### 3.1 Process Topology

```
┌──────────────────────────────────────────────────────────────────────┐
│  USER MACHINE                                                        │
│                                                                      │
│  ┌──────────────────────┐        ┌──────────────────────────────┐   │
│  │  AgenticOS           │        │  Hermes Daemon               │   │
│  │  (Next.js 16)        │        │  (127.0.0.1:7600)            │   │
│  │                      │        │                              │   │
│  │  ┌────────────────┐  │  HTTP  │  GET  /health                │   │
│  │  │ HermesClient   │◄─┼───────►│  GET  /tools                 │   │
│  │  │ (SSE + JSON)   │  │  SSE   │  POST /runs                  │   │
│  │  └────────────────┘  │        │  GET  /runs                  │   │
│  │                      │        │  GET  /runs/:id              │   │
│  │  ┌────────────────┐  │        │  POST /runs/:id/cancel       │   │
│  │  │  Scheduler     │  │        │  GET  /runs/:id/events (SSE) │   │
│  │  │ (node-cron)    │  │        │  GET  /cron                  │   │
│  │  │ reads          │  │        │  POST /cron                  │   │
│  │  │ cron.json      │  │        │  PUT  /cron/:id              │   │
│  │  └────────────────┘  │        │  DELETE /cron/:id            │   │
│  │                      │        │  POST /cron/:id/run          │   │
│  │  ┌────────────────┐  │        └──────────────────────────────┘   │
│  │  │  MCP-to-Vault  │  │                      │                    │
│  │  │  Server        │◄─┼──────────────────────┘  MCP over HTTP    │
│  │  │ (127.0.0.1:    │  │  (vault.*, lint.*, taxonomy.*)           │
│  │  │  7610)         │  │                                           │
│  │  └───────┬────────┘  │                                           │
│  │          │           │        ┌──────────────────────────────┐   │
│  │          │ HTTP      │        │  Vault on disk               │   │
│  │  ┌───────▼────────┐  │        │  ~/Documents/Dev Projects/   │   │
│  │  │ /api/vault/*   │  │        │  vault/                      │   │
│  │  │ /api/lint      │  │        │  wiki/_meta/curator-log.md   │   │
│  │  │ /api/taxonomy  │  │        └──────────────────────────────┘   │
│  │  └───────┬────────┘  │                      ▲                    │
│  │          │ fs/       │                      │                    │
│  │          └───────────┼──────────────────────┘                    │
│  │                      │  atomic writes (tmp + rename)             │
│  └──────────────────────┘                                           │
│                                                                      │
│  ~/.agenticos/cron.json           (chmod 0600, owned by AgenticOS)  │
│  ~/.agenticos/rate-limits.jsonl   (rolling 30-day window)           │
└──────────────────────────────────────────────────────────────────────┘
```

**Trust boundary**: All network listeners bind to `127.0.0.1` only. No auth tokens are required because the loopback + same OS user is the trust model (Decision 7). If the user switches Hermes to remote mode in Settings, a token field appears — but that is Phase 6 scope.

### 3.2 `packages/hermes-client/` Workspace Package

Mirrors the `@agenticos/vault-core` pattern from Phase 2 § 3.1. Pure TypeScript, no React, no Next dependencies. Server-only (`import 'server-only'` on the HTTP client module).

```
packages/hermes-client/
├── package.json              "name": "@agenticos/hermes-client"
├── tsconfig.json             extends @agenticos/tsconfig/base
├── src/
│   ├── index.ts              public API surface
│   ├── types.ts              HermesRun, HermesEvent, HermesCron, HermesHealth,
│   │                         HermesTool, RunVitalSigns, ScheduleRecord
│   ├── client.ts             class HermesClient  (import 'server-only')
│   ├── sse.ts                server-only SSE stream parser
│   └── errors.ts             HermesOfflineError, HermesTimeoutError,
│                             HermesRunNotFoundError
└── test/                     mirrors src/ — Vitest
```

`apps/dashboard/package.json` adds `"@agenticos/hermes-client": "workspace:*"`.

### 3.3 Data Types

```ts
// ── Core run types ──────────────────────────────────────────────────

type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';
type RunId     = string;   // Hermes-assigned UUID
type SkillId   = string;   // slug, e.g. "curator"
type CronId    = string;   // slug, e.g. "curator-nightly"

interface HermesRun {
  id:           RunId;
  skillId:      SkillId;
  status:       RunStatus;
  model:        string;          // e.g. "claude-sonnet-4-6"
  startedAt:    string;          // ISO
  completedAt?: string;          // ISO, only when terminal
  durationMs?:  number;
  costUsd?:     number;
  inputTokens:  number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cancelReason?: string;         // e.g. "stale" | "user" | "budget"
  tags:         string[];        // propagated from skill metadata
}

interface HermesEvent {
  runId:     RunId;
  seq:       number;             // monotonic sequence number
  ts:        string;             // ISO
  kind:      'log' | 'tool_call' | 'tool_result' | 'usage_delta' | 'status_change';
  payload:   unknown;            // typed per kind at consumption site
}

interface HermesCron {
  id:         CronId;
  skillId:    SkillId;
  schedule:   string;            // cron expression, e.g. "0 3 * * *"
  enabled:    boolean;
  lastRunAt?: string;            // ISO
  lastRunId?: RunId;
  nextRunAt:  string;            // ISO — computed by scheduler
}

interface HermesHealth {
  status:    'ok' | 'degraded' | 'offline';
  version:   string;
  uptimeMs:  number;
  activeRuns: number;
}

interface HermesTool {
  name:        string;           // e.g. "vault.page.read"
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

// ── Derived types for UI ────────────────────────────────────────────

interface RunVitalSigns {
  runId:           RunId;
  state:           RunStatus;
  lastEventAt:     number;       // Date.now() at last SSE event
  toolCallCount:   number;
  costUsd:         number;
  inputTokens:     number;
  outputTokens:    number;
  isStale:         boolean;      // client-derived: Date.now() - lastEventAt > threshold
  throttledUntil?: string;       // ISO; set when 429 retryAfter is present
}

// ── Scheduler (cron.json on disk) ───────────────────────────────────

interface ScheduleRecord {
  id:              CronId;
  skillId:         SkillId;
  schedule:        string;       // cron expression
  enabled:         boolean;
  lastRunAt?:      string;       // ISO
  lastRunId?:      RunId;
  nextRunAt?:      string;       // ISO — written by scheduler on each fire
  stalenessThresholdMs: number;  // Curator = 300_000, generic short = 30_000
}
```

### 3.4 `HermesClient` Interface

```ts
interface HermesClientInterface {
  // ── Daemon health ────────────────────────────────────────────────
  getHealth(): Promise<HermesHealth>;

  // ── Tools (static after daemon start) ───────────────────────────
  listTools(): Promise<HermesTool[]>;

  // ── Runs ─────────────────────────────────────────────────────────
  dispatchRun(params: {
    skillId:      SkillId;
    model?:       string;
    budget?:      number;         // USD cap
    toolNames?:   string[];       // allowed-tool whitelist
    systemPrompt: string;
    userPrompt:   string;
  }): Promise<HermesRun>;

  listRuns(opts?: {
    limit?:    number;
    status?:   RunStatus | RunStatus[];
    skillId?:  SkillId;
    since?:    string;            // ISO
  }): Promise<HermesRun[]>;

  getRun(id: RunId): Promise<HermesRun | null>;

  cancelRun(id: RunId, reason?: string): Promise<void>;

  // ── SSE stream (server-only) ─────────────────────────────────────
  streamRunEvents(id: RunId): AsyncIterable<HermesEvent>;

  // ── Cron (AgenticOS manages; these are convenience delegates) ───
  listCron(): Promise<HermesCron[]>;
  createCron(record: Omit<HermesCron, 'nextRunAt'>): Promise<HermesCron>;
  updateCron(id: CronId, patch: Partial<HermesCron>): Promise<HermesCron>;
  deleteCron(id: CronId): Promise<void>;
  triggerCron(id: CronId): Promise<HermesRun>;
}
```

`HermesClient` is a class that implements this interface. It is a process singleton — `lib/hermes/client-singleton.ts` holds the single instance and is imported by API routes. It is never imported client-side.

### 3.5 MCP-to-Vault Server

A second HTTP listener at `127.0.0.1:7610` exposes 11 MCP tools to Hermes. Each tool proxies to an existing AgenticOS API route. The MCP server enforces the same path-safety constraints as the API layer. No new business logic lives here.

| MCP Tool | Proxies to | Direction |
|----------|------------|-----------|
| `vault.page.read` | `GET /api/vault/page?path=` | Read-only |
| `vault.tree.list` | `GET /api/vault/tree` | Read-only |
| `vault.search` | `GET /api/vault/search?q=&tags=&limit=` | Read-only |
| `vault.backlinks` | `GET /api/vault/backlinks?path=` | Read-only |
| `vault.inbox.list` | `GET /api/vault/inbox` | Read-only |
| `vault.inbox.item` | `GET /api/vault/inbox/item?path=` | Read-only |
| `vault.inbox.promote` | `POST /api/vault/inbox/promote` | Write — LLM proposal |
| `vault.inbox.commit` | `POST /api/vault/inbox/commit` | Write — atomic |
| `vault.inbox.discard` | `POST /api/vault/inbox/discard` | Write — moves to archived |
| `lint.run` | `GET /api/lint` | Read-only compute |
| `taxonomy.list` | `GET /api/taxonomy` | Read-only |

The Curator skill is given a **9-tool whitelist** at dispatch time. `vault.inbox.promote` (the LLM-proposal route) is excluded because the Curator is itself the LLM making that judgment. `taxonomy.list` is excluded as unnecessary for curation tasks. The Curator's allowed-tool list:

```
vault.page.read
vault.tree.list
vault.search
vault.backlinks
vault.inbox.list
vault.inbox.item
vault.inbox.commit
vault.inbox.discard
lint.run
```

### 3.6 Daemon Lifecycle

AgenticOS does not supervise the Hermes daemon (Decision 5). The user starts it with `hermes serve`. AgenticOS detects it.

**Detection loop**: A server-side interval polls `GET http://127.0.0.1:7600/health` every 5 seconds. The result is stored in a process singleton and surfaced via `GET /api/hermes/health`.

**Header chip**: The global header gains a small status chip between the view tabs and the filter chip:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⬡ AgenticOS │ Architecture  Memory  Observability │ HERMES ●  [#farm] ⚙ │
└─────────────────────────────────────────────────────────────────────────┘
                                                      ▲
                         teal dot (--lane-hermes #4db6ac) = online
                         muted dot (--text-muted #6b6157) = offline
```

Chip: `caption` font, `rounded-sm`. Clicking opens a tooltip: "Hermes v0.x.x · X active runs · Uptime Xh Xm" (online) or "Hermes offline — run `hermes serve` to start" (offline). No modal or drawer. Skills that require Hermes gray out their "Dispatch" button when the chip is offline.

---

## 4. API Surface

### 4.1 Route Table

All routes under `apps/dashboard/app/api/hermes/`. All state-changing routes inherit Phase 2's `proxy.ts` Host/Origin gate (Phase 2 § 4.1), 64 KiB body limit, and Zod body validation.

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| `GET` | `/api/hermes/health` | Daemon status | Returns cached `HermesHealth`; 5s TTL |
| `GET` | `/api/hermes/tools` | List MCP tools | Cached until daemon version changes |
| `POST` | `/api/hermes/runs` | Dispatch a run | Body: `{ skillId, model?, budget?, userPrompt }` |
| `GET` | `/api/hermes/runs` | List runs | `?limit=&status=&skillId=&since=` |
| `GET` | `/api/hermes/runs/[id]` | Single run | `HermesRun \| 404` |
| `POST` | `/api/hermes/runs/[id]/cancel` | Cancel run | Body: `{ reason? }` |
| `GET` | `/api/hermes/runs/[id]/events` | SSE event stream | `text/event-stream`; proxies Hermes SSE |
| `GET` | `/api/hermes/cron` | List schedules | Reads `cron.json`; not delegated to Hermes |
| `POST` | `/api/hermes/cron` | Create schedule | Writes `cron.json`; registers with node-cron |
| `PUT` | `/api/hermes/cron/[id]` | Update schedule | Atomic write; re-registers cron task |
| `DELETE` | `/api/hermes/cron/[id]` | Delete schedule | Atomic write; unregisters cron task |
| `POST` | `/api/hermes/cron/[id]/run` | Manual trigger | Dispatches run outside cron schedule |

Rate-limit route (lives outside the `/api/hermes/` namespace):

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| `GET` | `/api/limits` | Rate-limit state | Returns `{ current, history }` from `rate-limits.jsonl` |

### 4.2 Caching / Freshness

```
/api/hermes/health       → 5s TTL (process singleton; background poll)
/api/hermes/tools        → cached until health check detects daemon restart (version change)
/api/hermes/runs         → no server-side cache; TanStack Query staleTime 10s, gcTime 30s
/api/hermes/runs/[id]    → TanStack Query staleTime 5s while status is running; 60s terminal
/api/hermes/cron         → reads cron.json; TanStack Query staleTime 30s
/api/limits              → reads rate-limits.jsonl; TanStack Query staleTime 60s
```

The SSE route `/api/hermes/runs/[id]/events` is a streaming proxy — no caching applies.

### 4.3 Revalidation Triggers

1. **Post-dispatch** — `POST /api/hermes/runs` success → client invalidates `['hermes', 'runs']`.
2. **Post-cancel** — `POST /api/hermes/runs/[id]/cancel` → invalidates `['hermes', 'runs', id]`.
3. **SSE `status_change` event** — `useRunEvents` hook invalidates `['hermes', 'runs', id]` when a terminal status is received.
4. **Post-cron write** — any cron mutation invalidates `['hermes', 'cron']`.
5. **Health chip interval** — every 5s; if daemon transitions offline → online, also invalidates `['hermes', 'runs']` to populate the feed.

---

## 5. The Three Active Flows

### 5.1 Curator Skill

**Schedule**: `0 3 * * *` (daily at 03:00 local time)
**Budget cap**: `$1.00` per run
**Model**: `settings.modelDefaults.sonnet` — resolves to `claude-sonnet-4-6` by default; honors the IA spec § 7 model routing table (task type `multi-step-autonomous`, default tier: Balanced)
**Allowed tools**: 9-tool whitelist (see § 3.5)
**Staleness threshold**: 300,000 ms (5 minutes)
**Output**: writes only `vault/wiki/_meta/curator-log.md` via the `vault.inbox.commit` MCP tool
**Implementation**: `apps/dashboard/lib/skills/curator.ts` — hardcoded TypeScript (Decision 4)

#### System Prompt (verbatim)

Lives at `apps/dashboard/lib/skills/prompts/curator-system.txt`:

```
You are the Curator, an autonomous knowledge-management agent for an Obsidian-format vault.

Your job runs nightly. You have access to vault tools only — no shell, no network outside the
vault MCP server, no file writes outside what the vault tools expose. You cannot modify wiki
pages directly; the only file you may update is wiki/_meta/curator-log.md (via vault.inbox.commit).

## Your tasks, in order

1. LIST the inbox. For each item older than 7 days (compare capturedAt to {{TODAY_ISO}}):

   a. READ the inbox item.
   b. SEARCH the wiki for related pages (use vault.search with 2–3 keywords from the note).
   c. Decide:
      - PROMOTE: if the note contains a genuine observation, fact, or idea that belongs in the wiki
        AND confidence >= 0.7. Call vault.inbox.commit with a fully-formed wiki page:
        destination path under wiki/, title (60 chars max), 1–5 existing tags where possible,
        refined body preserving original meaning, and DO NOT invent facts not in the note.
      - DISCARD: if the note is a pure reminder, single-URL bookmark with no thought, or TODO
        with no supporting context. Call vault.inbox.discard.
      - SKIP: if the note is recent (7 days or fewer), ambiguous, or requires human judgment.
        Do not act on it. Note it in the log as SKIPPED with a one-sentence reason.

2. RUN lint (lint.run). Record a count of each issue type.

3. WRITE the curator log entry. Call vault.inbox.commit with:
   - destination: wiki/_meta/curator-log.md  (append — include the full prior content plus the new entry)
   - See the log format specification below.

## Rules

- Never modify any wiki page except wiki/_meta/curator-log.md.
- Never discard an inbox item unless you are confident it has no lasting value.
- When in doubt, SKIP. The human can review.
- Preserve the author's voice when promoting. Clean up grammar and formatting, but do not
  editorialize or add information not present in the source note.
- If vault tools return errors, note them in the log and continue with remaining items.
- Stop before reaching the ${{BUDGET}} budget cap. If you are within $0.05 of the cap,
  write the log with a BUDGET_APPROACHING flag and stop processing further items.

## Log entry format

Each run appends one entry to wiki/_meta/curator-log.md in this format:

---
## {{TODAY_ISO}} — Curator Run

**Last run**: {{LAST_RUN_ISO}}
**Items processed**: N promoted, N discarded, N skipped
**Lint**: N broken links, N orphans, N todos
**Cost**: $X.XX
**Status**: completed | partial (reason) | budget_approaching

### Promoted
- [[destination/path]] — "original note title" (confidence: 0.N)

### Discarded
- inbox/filename.md — reason in one sentence

### Skipped
- inbox/filename.md — reason in one sentence

### Lint findings
- broken-link: [[Page Name]] in wiki/path/to/file.md
- (up to 10 items; "… and N more" if the list exceeds 10)
---
```

#### User Prompt Template

```
Today's date: {{TODAY_ISO}}
Last curator run: {{LAST_RUN_ISO}}
Budget cap: ${{BUDGET}}

Begin the curator workflow now.
```

#### Failure Modes

| Failure | Detection | Behavior |
|---------|-----------|----------|
| Hermes offline at cron fire | `getHealth()` returns offline | Skip fire; `lastRunId` unchanged; scheduler logs warning |
| Anthropic rate-limit (429) | `retryAfter` in `HermesEvent` payload | Run status → `failed`; badge shows "Throttled · resets in Xm"; no auto-retry |
| Budget cap reached | Hermes enforces `budget` param | Run completes with `cancelReason: "budget"`; log entry flags `BUDGET_APPROACHING` |
| Vault tool error | MCP server returns error JSON | Curator catches per-tool errors, notes them in log, continues remaining items |
| Log write failure | Non-2xx from `/api/vault/inbox/commit` | Run fails; error visible in run detail Logs tab |

#### Example `curator-log.md` Entry

```markdown
---
## 2026-05-19 — Curator Run

**Last run**: 2026-05-18
**Items processed**: 2 promoted, 1 discarded, 3 skipped
**Lint**: 4 broken links, 2 orphans, 7 todos
**Cost**: $0.18
**Status**: completed

### Promoted
- [[Farm/Syntropic/Bed-3-Comfrey-Notes]] — "comfrey root division notes" (confidence: 0.82)
- [[Software/AgenticOS/Hermes-Rate-Limit-Observations]] — "hermes limits 2026-05-11" (confidence: 0.74)

### Discarded
- inbox/2026-05-10-1422.md — Pure URL bookmark with no attached thought.

### Skipped
- inbox/2026-05-08-0934.md — Ambiguous; references "the plan" without sufficient context.
- inbox/2026-05-09-1115.md — Reminder to call supplier; no knowledge value.
- inbox/2026-05-12-1603.md — Within the 7-day window; not yet eligible.

### Lint findings
- broken-link: [[Ghost CMS v6]] in wiki/Software/Ghost-Integration.md
- broken-link: [[Odoo v17 Setup]] in wiki/Software/Odoo-Integration.md
- orphan: wiki/Farm/Old-Bed-Layout.md (0 backlinks)
- orphan: wiki/Personal/2025-Reflections.md (0 backlinks)
- … and 3 more broken links
---
```

### 5.2 Staleness Detection

**Mechanism**: Client-side, per-second re-render via a `useEffect` interval in the `RunCard` component. The check:

```ts
const isStale = Date.now() - vitalSigns.lastEventAt > skill.stalenessThresholdMs;
```

Per-skill thresholds (from `ScheduleRecord.stalenessThresholdMs`):

| Skill | Threshold | Rationale |
|-------|-----------|-----------|
| Curator | 300,000 ms (5 min) | Long-running; expected quiet periods between tool calls |
| Generic short skill | 30,000 ms (30 s) | Most Hermes skills should emit events frequently |

**Visual states** (using brand tokens from `docs/brand.md` § 2):

| State | Lane stripe color | Pulse interval | Status chip |
|-------|------------------|----------------|-------------|
| Running (normal) | `--lane-hermes` `#4db6ac` | 2s | RUNNING pill (`--info-bg` / `--info`) |
| Stale | `--accent-gold-400` `#c9a227` | 4s | STALE pill (`--warning-bg` / `--accent-gold-400`) |
| Throttled (429) | `--accent-gold-400` `#c9a227` | 4s | THROTTLED pill with reset countdown |

The lane stripe shifts from teal to gold when `isStale` becomes true. The 2px left border color transitions over `--motion-base` (240ms) using `--ease-standard`. The pulse animation keyframe slows from 2s to 4s.

**UX affordances on stale run**: The kebab menu gains "Cancel & restart" as the first item (above "View details"). Clicking it:

1. Calls `POST /api/hermes/runs/[id]/cancel` with `{ reason: "stale" }`.
2. Immediately dispatches the same skill with identical parameters.
3. The canceled run remains in the feed with status `canceled (stale)` for debugging.

**Throttled-specific affordance**: When `vitalSigns.throttledUntil` is set, the kebab menu shows "Wait & retry at HH:MM" as the primary action instead of generic cancel. Clicking schedules a deferred dispatch at `throttledUntil`. The THROTTLED chip reads "Throttled · resets in Xm" (countdown ticks per second).

**Scheduler sanity cancel**: Before each cron fire, the node-cron scheduler checks whether a `running` run for the same `skillId` has been silent > 30 minutes (`lastEventAt` age check via `GET /api/hermes/runs?skillId=X&status=running`). If found, it cancels the run with `reason: "stale-sanity"` before dispatching the new one. This prevents duplicate accumulation across app restarts.

### 5.3 Rate-Limit Observability

**Capture**: Passive — zero extra API calls. Anthropic returns 6 rate-limit dimensions in every response header. The Hermes daemon forwards these through its SSE event stream on `usage_delta` events. `packages/hermes-client/src/sse.ts` parses them and the API route at `apps/dashboard/app/api/hermes/runs/[id]/events/route.ts` calls `lib/limits/writer.ts` to append each sample.

**Storage**: `~/.agenticos/rate-limits.jsonl`. Each line is a `RateLimitSample`:

```ts
interface RateLimitSample {
  ts:                  string;   // ISO
  runId:               RunId;
  limitRequests:       number;
  remainingRequests:   number;
  resetRequestsAt:     string;   // ISO
  limitTokens:         number;
  remainingTokens:     number;
  resetTokensAt:       string;   // ISO
  retryAfter?:         number;   // seconds; only present on 429 events
}
```

Rolling 30-day window enforced on write (atomic rewrite — acceptable at ~1 write per tool call). Atomic writes follow Phase 2 § 3.3 (tmp + rename + chmod 0600).

**`lib/limits/` module**: `apps/dashboard/lib/limits/` (not a workspace package; scope does not justify it).

```
apps/dashboard/lib/limits/
├── reader.ts       readRateLimits(since?: string): RateLimitSample[]  (server-only)
├── writer.ts       appendRateLimitSample(sample: RateLimitSample): void
└── projection.ts   willNextRunFit(schedule: ScheduleRecord, history: RateLimitSample[]): ProjectionResult
```

**`/api/limits` route**: `GET /api/limits` returns:

```ts
{
  current: {
    requests: { limit: number; remaining: number; resetAt: string };
    tokens:   { limit: number; remaining: number; resetAt: string };
    sampledAt: string;
  } | null;
  history: RateLimitSample[];   // last 24h, for sparkline rendering
}
```

**Three nested views** in the Observability sidebar (below the SCHEDULE section, per IA spec § 4):

```
RATE LIMITS
────────────────────────────────────────

[compact — always visible]
  Requests  ████████░░  84%  resets 12m
  Tokens    ██████████  97%  resets 12m

[▾ Show history — expanded on click]
  Requests  ████████░░  84%  resets 12m
  [24h sparkline SVG 120×24px — hourly bars in --lane-hermes #4db6ac]

  Tokens    ██████████  97%  resets 12m
  [24h sparkline SVG]

[projection — always visible below bars]
  ● Curator (next: 03:00) — fits comfortably
  ⚠ Farm Brief (next: 07:00) — risk of throttle
```

Progress bar fill color: `--lane-hermes` (`#4db6ac`) ≤ 80%; `--accent-gold-400` (`#c9a227`) 80–95%; `--error` (`#f87171`) > 95%.

Sparkline SVGs are 120×24px, rendered server-side as inline SVG from the history array — no charting library dependency. Each bucket is one hour; 24 buckets shown. Bars use `--lane-hermes` fill at normal usage; `--accent-gold-400` on buckets where `remainingTokens / limitTokens < 0.2`.

**Coupling with staleness**: When a 429 causes a run to stall, `vitalSigns.throttledUntil` is set from `retryAfter`. The RunCard THROTTLED chip shows the countdown; the kebab shows "Wait & retry at HH:MM" (§ 5.2).

---

## 6. Migration: Phase 2 Fixture RunCards → Real Hermes Data

The Observability feed currently renders from `apps/dashboard/lib/fixtures/runs.ts`. Phase 3 migrates component by component — following the Phase 2 § 6 pattern of import swaps, not rewrites.

| Component | Before (fixture) | After (real data) |
|-----------|-----------------|------------------|
| `RunFeed.tsx` | `RUNS_FIXTURE` static array | `useRunFeed()` → `GET /api/hermes/runs` |
| `RunCard.tsx` (props) | Static fixture shape | Props from `HermesRun` |
| `RunCard.tsx` (lane stripe) | CSS class always-on | 2px border; color from `skillId` → lane lookup |
| `RunCard.tsx` (pulse) | Static animation | Conditional on `status === 'running'`; gold + 4s when stale |
| `RunCard.tsx` (status) | Hardcoded string | `RunVitalSigns` from `useRunVitalSigns(runId)` |
| `LiveStrip.tsx` | Empty / stub pills | `useRunFeed({ status: 'running' })` filtered |
| `SchedulesSidebar.tsx` | Hardcoded rows | `useHermesCron()` → `GET /api/hermes/cron` |
| `RunDetailDrawer.tsx` — Logs | Static text | `useRunEvents(runId)` → SSE stream |
| `RunDetailDrawer.tsx` — Usage | Fixture token counts | `HermesRun` token fields |
| `MetricsSidebar.tsx` | Fixture cost sums | Derived from `listRuns()` aggregated client-side |

Three one-time setup items alongside:

1. **Delete** `apps/dashboard/lib/fixtures/runs.ts` once all consumers are migrated. (`skills.ts` stays until Phase 4.)
2. **Add** `apps/dashboard/lib/hermes/client-singleton.ts` — guarded by `import 'server-only'`.
3. **Add** `RateLimitsPanel` component in the Observability sidebar (new; no existing stub).

---

## 7. Sequencing

Five waves, six Asana tasks. Wave 2 (T2 + T3) runs in parallel; all other waves are solo. Estimates are half-days.

```
Wave 1   T1  hermes-client package                             1.5 hd
              @agenticos/hermes-client types, HermesClient,
              SSE parser, error types, unit tests
              └── solo Sonnet agent, worktree-isolated

Wave 2   T2  /api/hermes/* routes        T3  Scheduler         2.0 hd  (parallel)
              11 route handlers               node-cron loop
              Zod schemas                     cron.json atomic writes
              route integration tests         sanity-cancel logic
              └── Sonnet, worktree T2         └── Sonnet, worktree T3
              (disjoint: app/api/hermes/      (disjoint: lib/scheduler/)
               vs lib/scheduler/)

Wave 3   T4  Observability migration + staleness UI            2.0 hd
              ALSO: rate-limit capture + RateLimitsPanel
              RunFeed + RunCard wired to live data
              Gold lane stripe, 4s pulse, STALE/THROTTLED chips
              /api/limits route + lib/limits/ module
              └── solo Sonnet agent, worktree-isolated

Wave 4   T5  Curator skill + MCP-to-vault binding              2.5 hd
              apps/dashboard/lib/skills/curator.ts
              curator-system.txt prompt file
              MCP server at 127.0.0.1:7610 (11 tools)
              Integration test: full curator dry-run on test vault
              └── solo Sonnet agent, worktree-isolated

Wave 5   T6  Cron UI + "Run now"                               1.5 hd
              SchedulesSidebar wired to /api/hermes/cron
              /observability/schedules full table
              "Run now" → POST /api/hermes/cron/[id]/run
              "+ Add Schedule" drawer
              └── solo Sonnet agent, worktree-isolated
```

**Total estimated wall-clock**: ~9.5 half-days (~5 working days).

**Asana task GIDs** (to be filled when tasks are created in the AgenticOS project):

| Task | Label | GID |
|------|-------|-----|
| T1 | hermes-client package | TBD |
| T2 | /api/hermes/* routes | TBD |
| T3 | Scheduler | TBD |
| T4 | Observability migration + rate limits | TBD |
| T5 | Curator skill + MCP-to-vault | TBD |
| T6 | Cron UI + "Run now" | TBD |

---

## 8. Testing Strategy

Target: ~190 tests (current 83 from Phase 2 + ~107 new).

| Location | What is tested | Target |
|----------|---------------|--------|
| `packages/hermes-client/test/` | Type shapes; `HermesClient` method contracts (mock HTTP server); SSE parser event sequences; error types; offline / timeout behavior | ~30 |
| `apps/dashboard/lib/hermes/test/` | `client-singleton.ts` instantiation guard; health poll state machine; sanity-cancel trigger logic | ~8 |
| `apps/dashboard/lib/limits/test/` | `reader.ts` rolling window; `writer.ts` atomic prune; `projection.ts` fits / throttle-risk projection cases | ~12 |
| `apps/dashboard/lib/skills/test/` | Curator prompt template substitution; budget-cap exit path; 7-day age filter logic | ~6 |
| `apps/dashboard/app/api/hermes/*/route.test.ts` | All 11 routes + `/api/limits`: happy path, Zod rejection, 404, daemon-offline fallback; `mkdtemp` scratch `cron.json` | ~20 |
| `apps/dashboard/app/api/hermes/[id]/events/route.test.ts` | SSE proxy: event pass-through, client disconnect cleanup, Hermes-offline fallback `data: {"error":"offline"}` | ~8 |
| `packages/hermes-client/test/mcp-server.test.ts` | Each of 11 MCP tools proxies to correct route; path-safety rejection; non-whitelisted tool returns 403 | ~12 |
| `apps/dashboard/components/observability/__tests__/` | RunCard staleness state machine; gold stripe at threshold; STALE chip text; "Cancel & restart" visibility; RateLimitsPanel compact bars render | ~8 |
| Playwright E2E | (1) `/observability` → dispatch skill → RunCard live SSE update → RUNNING → DONE; (2) Curator dry-run → `curator-log.md` appears in vault tree on `/memory` | 3 |

**CI benchmarks** (fail build if regressed):
- `HermesClient.listRuns()` parsing 500 fixture runs: < 100 ms.
- MCP server loopback round-trip (tool call → proxied response): < 50 ms.

---

## 9. Risks + Unknowns

1. **Hermes SSE protocol stability** — Hermes is under active development. The `HermesEvent` shape in `packages/hermes-client/` must be versioned carefully. Mitigation: use `unknown` payload typed at consumption site via Zod; semantic version the client package; bump on breaking schema change.

2. **node-cron accuracy on macOS sleep/wake** — Laptops sleep. `node-cron` fires on wake if the scheduled time was missed, but fires at most once (does not replay all missed intervals). Mitigation: accepted. The Curator is idempotent — it processes items older than 7 days, so a missed fire shifts the processing window by one day without correctness loss.

3. **`curator-log.md` append race** — If two Curator runs somehow overlap (edge case: stale-sanity cancel fires simultaneously with a new dispatch), both could attempt to `vault.inbox.commit` to `wiki/_meta/curator-log.md`. Mitigation: scheduler sanity-cancel prevents overlapping runs; the commit route uses atomic tmp+rename, so the last writer wins without file corruption.

4. **Rate-limit header availability from Hermes** — The Hermes daemon must forward Anthropic response headers through its SSE event stream. If the running version of Hermes does not yet expose these, the capture path falls back gracefully: `RateLimitsPanel` shows "No data yet — headers not available from this Hermes version." No Phase 3 feature other than the panel itself is blocked.

5. **`cron.json` and multi-device** — `cron.json` lives in `~/.agenticos/` outside the vault; it does not roam with iCloud Drive or Obsidian Sync. Two machines would run independent cron schedules, potentially dispatching duplicate Curator runs against the same vault. Mitigation: accepted for Phase 3 (single-developer, single primary machine); Phase 6 may introduce a vault-relative schedule store.

---

## 10. References

- Phase 2 design spec: [`docs/phase-2-design.md`](./phase-2-design.md) — atomic write pattern § 3.3, route table structure § 4.1, revalidation triggers § 4.3, model routing § 5.1.2, sequencing § 7
- Brand & visual design system: [`docs/brand.md`](./brand.md) — § 2 (color tokens: `--lane-hermes` `#4db6ac`, `--accent-gold-400` `#c9a227`, `--accent-plum-400` `#8c6bce`, `--warning-*`); § 7.2 (RunCard anatomy, lane stripe, status pills)
- Information Architecture: [`docs/information-architecture.md`](./information-architecture.md) — § 4 (Observability view layout, RunCard anatomy, Schedules subview, Metrics sidebar); § 7 (model routing table, `multi-step-autonomous` → Balanced tier default)
- Phase 3 brainstorming checkpoint: [`docs/phase-3-brainstorming-checkpoint.md`](./phase-3-brainstorming-checkpoint.md) — all 11 resolved decisions, Curator behavior, 5-wave sequencing
- Phase 1 plan: [`docs/plans/phase-1-mvp-foundation.md`](./plans/phase-1-mvp-foundation.md) — fixture-backed predecessors being replaced
- Hermes README: <https://github.com/nousresearch/hermes-agent>
- Vault governance: `~/Documents/Dev Projects/vault/CLAUDE.md` — promotion rules, tag taxonomy, inbox conventions
- **IA spec drift note**: `docs/information-architecture.md` § 6 (Hermes Daemon Settings) lists API port `8765`. Phase 3 locks in port `7600` (Decision 1). The IA spec should be updated to `7600` in the next revision. MCP server port `7610` is new in Phase 3 and should also be added to the Settings section of the IA spec.
