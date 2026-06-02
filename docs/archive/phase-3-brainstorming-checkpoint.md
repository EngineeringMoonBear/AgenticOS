# Phase 3 — Hermes Integration: Brainstorming Checkpoint

> **⚠️ HISTORICAL (predates the 2026-05-20 foundation v2 pivot):** This checkpoint captured the first Phase 3 brainstorm against Hermes Agent as runtime. The Phase 3 architecture pivoted twice on 2026-05-20: first to Letta, then to the current composed stack (Claude Code + Honcho + Obsidian on DigitalOcean) documented in [`superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md). Preserved as decision trail.

**Status**: Brainstorming complete (2026-05-18); superseded by foundation v2 spec.

**Approach chosen**: A — Pragmatic. Ship Hermes integration narrowly; Curator is hardcoded TypeScript. Skill abstraction deferred to Phase 4 (which has two examples to abstract from: Curator + first Sandcastle skill).

---

## Resolved Decisions (locked in today)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Hermes integration model | **Persistent daemon + HTTP** on `127.0.0.1:7600` |
| 2 | Cron / schedule ownership | **AgenticOS owns schedules** (`~/.agenticos/cron.json`); Hermes is executor |
| 3 | Phase 3 scope | **Infrastructure + one real Curator skill** (5–6 sessions estimated, 9.5 half-days with rate-limit addition) |
| 4 | Skill abstraction | **Hardcoded TypeScript** in Phase 3 (`lib/skills/curator.ts`); abstract in Phase 4 |
| 5 | Daemon supervision | **Not supervised by AgenticOS**. Detect via `/health` ping; surface up/down chip in header; user owns `hermes serve` lifecycle |
| 6 | Vault writes from Hermes | **Via MCP-to-AgenticOS** — Hermes calls `/api/vault/*` through MCP server we host. No direct FS writes |
| 7 | Auth between Hermes ↔ AgenticOS | **None**. Loopback binding + same OS user is the trust boundary |
| 8 | Routes — fold or split | **11 separate routes**. SSE + JSON have different lifecycles; folding adds complexity |
| 9 | Scheduler needs AgenticOS running | **Accept the constraint**. launchd integration deferred to Phase 6 polish |
| 10 | Staleness detection | **Per-skill threshold** (Curator: 5 min; generic short skill: 30s). Surface in UI; auto-cancel deferred to Phase 6 |
| 11 | Rate-limit observability | **Include in Phase 3** (passive header capture; 24h sparkline; "will the next run fit?" projection) |

---

## Section 1 — Architecture + `hermes-client`

- **New workspace package**: `packages/hermes-client/` (mirrors `@agenticos/vault-core` pattern)
- Types: `HermesRun`, `HermesEvent`, `HermesCron`, `HermesHealth`, `HermesTool`
- `HermesClient` class wraps Hermes daemon HTTP+SSE API
- Server-only SSE parser at `packages/hermes-client/src/sse.ts`
- Daemon health chip in header polls `/api/hermes/health` every 5s

## Section 2 — API + Scheduler + MCP

- **11 routes** under `/api/hermes/`: health, tools, runs (POST/GET/[id]/cancel), runs/[id]/events (SSE), cron (CRUD + manual /run)
- **Scheduler**: in-Node node-cron loop, reads `~/.agenticos/cron.json`, atomic writes (tmp + rename + chmod 0600)
- Schedule format includes `id, skillId, schedule (cron expr), enabled, lastRunAt, lastRunId, nextRunAt`
- **MCP server** at `127.0.0.1:7610` exposes 11 vault tools to Hermes: `vault.page.read`, `vault.tree.list`, `vault.search`, `vault.backlinks`, `vault.inbox.{list,item,promote,commit,discard}`, `lint.run`, `taxonomy.list`
- Scheduler sanity check: if a `running` run has been silent > 30 min, cancel before next cron fire

## Section 3 — Curator Skill (concrete)

- **Schedule**: `0 3 * * *` (daily 03:00 local)
- **Allowed tools**: 9-tool subset of MCP surface — no shell, no FS outside vault, no network outside `vault.*` / `lint.*`
- **Staleness threshold**: 5 minutes
- **Estimated cost**: ~$0.10–0.40 per run; budget cap $1.00
- **Behavior**:
  - Process inbox items > **7 days** old
  - Promote if `confidence >= 0.7`; discard if pure-TODO; skip otherwise
  - Run lint (no auto-fix); append findings to `vault/wiki/_meta/curator-log.md`
  - Write log only — never modifies other wiki pages
- **System prompt**: full text drafted, lives at `apps/dashboard/lib/skills/prompts/curator-system.txt`
- **User prompt template**: substitutes `{{TODAY_ISO}}`, `{{LAST_RUN_ISO}}`, `{{BUDGET}}`
- **Manual trigger**: "Run now" button per schedule in cron UI

## Section 4 — Observability + Staleness + Rate Limits

### Real-time wiring
- `useRunEvents(runId)` consumes SSE from `/api/hermes/runs/[id]/events`
- RunCard derives `{state, lastEventAt, toolCallCount, costUsd, inputTokens, outputTokens}` from event stream
- Lane stripe pulses teal while running

### Staleness detection
- Client-side per-second re-render checks `Date.now() - lastEventAt > skill.stalenessThresholdMs`
- Stale: lane stripe shifts gold, pulse slows to 4s, chip reads "Stale · 3m 12s"
- "Cancel & restart" surfaces above "View details" in kebab menu
- Canceled-stale runs stay in feed for debugging (reason: `"stale"`)

### Rate-limit observability (new addition)
- **Capture**: free — Anthropic returns 6 limit dimensions in every response header
- **Storage**: `~/.agenticos/rate-limits.jsonl` (rolling 30-day window)
- **`/api/limits`** returns `{ current, history }`
- **3 nested views** in Observability sidebar:
  1. **Compact**: per-dimension bar (% used + time-to-reset)
  2. **Expanded**: above + 24h SVG sparkline per dimension
  3. **Projection**: "💚 Curator (next: 03:00) — fits in budget" or "⚠ risk of throttle"
- **Couples with staleness**: 429 responses make stale badge read "Throttled · resets in 12m" with `Wait & retry at HH:MM` action instead of generic cancel

### Sequencing (6 Asana tasks → 5 waves)

```
T1 hermes-client package                       (Wave 1, solo)
T2 /api/hermes/* + T3 scheduler                (Wave 2, parallel)
T4 Observability migration + staleness UI      (Wave 3, solo)
   └─ ALSO: rate-limit capture + RateLimitsPanel
T5 Curator skill + MCP-to-vault binding        (Wave 4, solo)
T6 Cron UI + "Run now"                         (Wave 5, solo)
```

Estimated **~9.5 half-days (~5 working days)**. Test target: 144 + ~46 = **~190 tests**.

---

## Resume next session

1. Read this checkpoint + `docs/phase-3-brainstorming-checkpoint.md` (this file)
2. Write the full Phase 3 design spec at `docs/phase-3-hermes-integration.md` (mirrors Phase 2's spec structure — Goals, Resolved Decisions, Architecture, API Surface, Curator Skill, Observability + Rate Limits, Migration, Sequencing, Testing, Risks, References)
3. Open PR for review (matches Phase 2's docs/phase-2-design.md flow)
4. After approval: invoke `superpowers:writing-plans` for the granular implementation plan
5. Dispatch Wave 1 (T1 hermes-client) — Sonnet subagent with worktree isolation

---

## References

- `docs/information-architecture.md` § 4 (Observability), § 7 (Model Routing)
- `docs/brand.md` § 7 (RunCard anatomy), § 9 (component inventory)
- `docs/phase-2-design.md` — pattern reference for spec structure
- `~/.agenticos/config.json` — `modelDefaults.sonnet` (Curator uses this)
- Hermes README: <https://github.com/nousresearch/hermes-agent>
- Vault governance: `~/Documents/Dev Projects/vault/CLAUDE.md`
