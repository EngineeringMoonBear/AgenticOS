# Phase 3 — Letta Integration: Design

> **⚠️ SUPERSEDED (same day, 2026-05-20):** Written in the morning of 2026-05-20 as the Letta-shaped Phase 3 spec. Superseded later the same day by `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`, which pivots to **Claude Code (Max OAuth) + Honcho + Obsidian + DigitalOcean** in response to new constraints (24/7 autonomous, $0 marginal LLM spend, Claude Max as the LLM source). This document is preserved as historical context; do not use it as current specification.

**Status**: Superseded (see header note)
**Status (original)**: Proposed (2026-05-20)
**Owner**: AgenticOS — single-developer (Josh)
**Supersedes**: `docs/archive/phase-3-hermes-integration.md` (the original Hermes-shaped spec; see ADR 0004 for the pivot rationale)
**Companion**: `docs/adr/0004-pivot-hermes-to-letta.md` — the decision record explaining why this doc exists in its current shape

---

## 1. Goals

Phase 3 connects AgenticOS to a live **Letta** server, ships a real Curator agent, and adds rate-limit observability. By the end of Phase 3:

- The Observability run feed consumes real Letta message-stream data via SSE rather than fixture stubs.
- AgenticOS uses the official `@letta-ai/letta-client` npm SDK as the integration layer — no in-house client package.
- AgenticOS owns cron schedules in `~/.agenticos/cron.json`; Letta executes by receiving dispatched messages.
- A persistent **Curator Letta agent** runs nightly at 03:00 local time, processes vault inbox items > 7 days old, writes only to `vault/wiki/_meta/curator-log.md`, and **accumulates learning** in its memory blocks across nights.
- The AgenticOS MCP-to-vault server on `127.0.0.1:7610` (Wave 4 work) is registered with Letta as a streamable-HTTP MCP server; the Curator agent calls vault tools through it.
- Staleness detection surfaces stalled runs in the UI (gold lane stripe, STALE/THROTTLED chips) — unchanged from the original spec.
- Anthropic rate-limit signal is captured passively from Letta SSE `usage_statistics` events and surfaced in a three-view Observability sidebar panel.

**Non-goals** (carry over from the original spec, still deferred):

- `auto-cancel-stale` toggle — Phase 6.
- `launchd` / `systemd` supervision of the Letta Docker container — Phase 6. AgenticOS detects Letta health; it does not manage the container's lifecycle.
- Skill abstraction (`SkillRunner` interface, YAML-defined skills) — Phase 4 will have Curator + first Sandcastle skill to abstract from.
- Persistent run history index inside AgenticOS — Letta itself persists agent state; AgenticOS reads from Letta.
- Mobile-specific Observability improvements — read-only mobile view unchanged.

---

## 2. Resolved Decisions

All decisions from the original Phase 3 spec were re-evaluated against Letta on 2026-05-20. The table reflects current state.

| # | Decision | Choice | Origin |
|---|----------|--------|--------|
| 1 | Runtime integration model | Persistent Letta server (Docker) + REST API on `127.0.0.1:8283` + SSE for streaming | Revised in ADR 0004; replaces "Hermes daemon on 7600" |
| 2 | Cron / schedule ownership | AgenticOS owns schedules (`~/.agenticos/cron.json`); Letta executes by receiving dispatched messages | Original spec §2 #2; affirmed by ADR 0003; executor changed |
| 3 | Phase 3 scope | Infrastructure + one real Curator agent | Original |
| 4 | Skill abstraction | Curator is a persistent Letta agent with named memory blocks and attached MCP tools. No internal abstraction layer in Phase 3 | Revised — was "hardcoded TS skill"; now leverages Letta's native primitives |
| 5 | Runtime supervision | Not supervised by AgenticOS; detect via `GET /v1/health` ping | Original |
| 6 | Vault writes from agent | Via MCP-to-AgenticOS server at `127.0.0.1:7610`, attached to the Curator agent as MCP tools | Original direction; mechanism unchanged |
| 7 | Auth between AgenticOS ↔ Letta | None | Loopback binding + same OS user is the trust boundary; matches Letta's self-hosted default |
| 8 | Routes — fold or split | 7 API routes under `app/api/letta/` (down from 11 — Letta's API absorbs cron/runs into the agent/message model) | Revised; simpler |
| 9 | Scheduler requires AgenticOS running | Accept the constraint | Original; affirmed |
| 10 | Staleness detection | Per-agent threshold based on Letta message-stream activity; surface in UI; auto-cancel deferred | Original logic; data source changed |
| 11 | Rate-limit observability | Include in Phase 3 — passive capture from SSE `usage_statistics` events; 24h sparkline; projection | Original intent; cleaner data source |
| 12 | Client package strategy | Use `@letta-ai/letta-client` from npm directly; **no in-house client package** | New — eliminates `packages/hermes-client/` maintenance burden |
| 13 | Curator memory model | Three memory blocks at creation: `persona`, `human`, `vault_conventions`. The third grows over time | New — leverages Letta's first-class memory primitives |

---

## 3. Architecture

### 3.1 Process Topology

```
┌────────────────────────────────────────────────────────────────────┐
│  USER MACHINE                                                      │
│                                                                    │
│  ┌──────────────────────────────┐     ┌────────────────────────┐   │
│  │  AgenticOS (Next.js 16)      │     │  Letta server          │   │
│  │  pnpm dev / production       │     │  (Docker container)    │   │
│  │                              │     │  127.0.0.1:8283        │   │
│  │  @letta-ai/letta-client      │HTTP │                        │   │
│  │  (server-only singleton)     ├────►│  GET  /v1/health       │   │
│  │                              │SSE  │  GET  /v1/agents       │   │
│  │  Scheduler                   │◄────│  POST /v1/agents       │   │
│  │  (node-cron in process)      │     │  POST /v1/agents/{id}/ │   │
│  │  ~/.agenticos/cron.json      │     │       messages         │   │
│  │                              │     │  POST /v1/agents/{id}/ │   │
│  │  Rate-limit writer           │     │       messages/stream  │   │
│  │  ~/.agenticos/               │     │       (SSE)            │   │
│  │  rate-limits.jsonl           │     │  GET  /v1/agents/{id}/ │   │
│  │                              │     │       core-memory      │   │
│  │  MCP-to-vault server         │MCP  │  POST /v1/mcp-servers  │   │
│  │  127.0.0.1:7610              │◄────│  GET  /v1/tools        │   │
│  │  (Wave 4, unchanged)         │     │                        │   │
│  │                              │     │  Postgres + pgvector   │   │
│  └──────────────────────────────┘     │  bundled; persists at  │   │
│                                       │  ~/.letta/.persist/    │   │
│  Vault filesystem                     └────────────────────────┘   │
│  ~/Documents/Dev Projects/vault/                                   │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Lifecycle

**User starts AgenticOS** — `instrumentation.ts` boots the scheduler + MCP-to-vault server in-process. Status of Letta is polled via `/v1/health`.

**Scheduler fires (03:00)** — `lib/scheduler/` reads `cron.json`, finds the Curator entry, dispatches `client.agents.messages.create(curatorAgentId, { input: "Process today's inbox per your standing instructions.", streaming: true })`. The streaming response feeds the RunCard + RateLimitsPanel via existing UI plumbing.

**Curator agent runs** — calls vault MCP tools via Letta's MCP forwarding, classifies items, writes its log to `wiki/_meta/curator-log.md`, optionally updates its own `vault_conventions` memory block when it encounters a novel pattern.

**User opens Observability** — `/api/letta/runs` (renamed from `/api/hermes/runs`) lists recent agent messages with cost + status. `/api/letta/runs/[id]/events` re-streams a recent message's SSE if a re-watch is requested.

### 3.3 What persists where

| State | Owner | Path |
|---|---|---|
| Agent definitions, memory blocks, message history | Letta | `~/.letta/.persist/pgdata/` (Postgres volume) |
| Cron schedules | AgenticOS | `~/.agenticos/cron.json` |
| Rate-limit time series (30-day rolling) | AgenticOS | `~/.agenticos/rate-limits.jsonl` |
| AgenticOS config (project roots, vault path, model defaults) | AgenticOS | `~/.agenticos/config.json` |
| Vault content (the actual knowledge) | User filesystem | `~/Documents/Dev Projects/vault/` |
| Curator log | User filesystem | `~/Documents/Dev Projects/vault/wiki/_meta/curator-log.md` |

The clean separation means: **a `docker volume rm letta-data` does not lose any user content.** Only the Curator's accumulated learning. That's recoverable by rerunning the agent over time.

---

## 4. The Curator Agent

### 4.1 Agent definition (created on first AgenticOS launch)

```ts
const curator = await client.agents.create({
  name: "curator",
  model: "anthropic/claude-sonnet-4-6",
  embedding: "openai/text-embedding-3-small",
  memory_blocks: [
    {
      label: "persona",
      value: `You are the Curator for Josh's vault — a knowledge base running on Obsidian-format markdown at /Users/joshuadunbar/Documents/Dev Projects/vault/. Your job: process inbox items, lint wiki links, surface promotion candidates, write your nightly summary to wiki/_meta/curator-log.md. Be brief. Be conservative — when in doubt, defer rather than promote. Surface uncertainty in your log.`,
    },
    {
      label: "human",
      value: `Josh, single-developer on Goldberry Grove. Projects include AgenticOS, the vault itself, and various coding projects under ~/Documents/Dev Projects/. Voice: terse, direct, prefers honest framing over polished framing.`,
    },
    {
      label: "vault_conventions",
      value: `(Empty at agent creation. The Curator will accumulate observations here over time — taxonomy preferences, classification edge cases, common ambiguities. This block grows.)`,
    },
  ],
  tool_ids: await registerVaultMcpTools(client), // see §4.2
});
```

### 4.2 Tool attachment via MCP

```ts
async function registerVaultMcpTools(client: LettaClient) {
  // Register the AgenticOS vault MCP server once (idempotent)
  const server = await client.mcpServers.upsert({
    server_name: "agenticos-vault",
    config: {
      mcp_server_type: "streamable_http",
      server_url: "http://127.0.0.1:7610",
    },
  });
  // Fetch the 11 vault tools advertised by our MCP server
  const tools = await client.mcpServers.listTools(server.id);
  return tools.map((t) => t.id);
}
```

The 11 tools are the same ones built in Wave 4 of the original Phase 3 (`vault.inbox.list`, `vault.read`, `vault.write`, `vault.lint`, `taxonomy.get`, etc.) — the whitelist excluding `vault.inbox.promote` and `taxonomy.list` is enforced at the MCP-server side, not at Letta. Curator simply doesn't see those tools.

### 4.3 Nightly dispatch

Scheduler fires at `0 3 * * *` and calls:

```ts
const stream = await client.agents.messages.create(curatorAgentId, {
  messages: [{ role: "user", content: "Process today's inbox per your standing instructions." }],
  streaming: true,
});
for await (const event of stream) {
  rateLimitWriter.consume(event);  // captures usage_statistics events
  runFeed.consume(event);           // updates UI via SSE re-broadcast
}
```

Budget enforcement is via the Curator's persona instruction ("$1.00 budget") plus AgenticOS's hard cutoff on `usage_statistics` accumulated cost. If the soft and hard limits disagree (Letta has no native budget cap), AgenticOS aborts the SSE stream and records `status="budget_exceeded"`.

### 4.4 Learning loop

The Curator can write to its own `vault_conventions` block via Letta's `core_memory_replace` tool (built-in to every agent). Over time, the block accumulates observations like:

- "Items tagged `#research/draft` without a date in frontmatter are usually not promotion candidates"
- "Source notes from `vault/sources/` get a 14-day grace period instead of 7"
- "Items whose first heading matches an existing wiki page are likely duplicates — flag, don't promote"

These are not hand-written. They emerge from the agent's experience and are inspectable via `GET /v1/agents/curator/core-memory/blocks/vault_conventions`. AgenticOS surfaces them in the Observability panel.

---

## 5. Code changes (from the original Hermes-shaped Wave work)

### 5.1 Deleted

- `packages/hermes-client/` — replaced by `@letta-ai/letta-client` SDK
- `apps/dashboard/lib/hermes/` — replaced by `lib/letta/`
- The `eventsource-parser` dependency (Letta SDK handles SSE internally)

### 5.2 Renamed (mechanical)

| Before | After |
|---|---|
| `app/api/hermes/runs/route.ts` | `app/api/letta/runs/route.ts` |
| `app/api/hermes/runs/[id]/events/route.ts` | `app/api/letta/runs/[id]/events/route.ts` |
| `app/api/hermes/runs/[id]/cancel/route.ts` | `app/api/letta/runs/[id]/cancel/route.ts` |
| `app/api/hermes/health/route.ts` | `app/api/letta/health/route.ts` |
| `app/api/hermes/tools/route.ts` | `app/api/letta/tools/route.ts` |
| `app/api/hermes/cron/*` | (deleted — Letta has no cron API; AgenticOS scheduler is sole owner) |
| `lib/hooks/use-hermes-health.ts` | `use-letta-health.ts` |
| `lib/hooks/use-run-feed.ts` | unchanged (orchestration-layer logic) |
| `lib/hooks/use-run-events.ts` | unchanged |
| `components/observability/HermesStatusChip.tsx` | `LettaStatusChip.tsx` |
| `lib/hermes/client-singleton.ts` | `lib/letta/client-singleton.ts` |

### 5.3 Unchanged from Wave work

- `apps/dashboard/lib/mcp-vault/` — the entire MCP-to-vault server (server.ts, tools.ts, types.ts)
- `apps/dashboard/lib/scheduler/` — cron-io.ts, scheduler.ts (the dispatch *target* changes; the scheduler itself is identical)
- `apps/dashboard/lib/limits/` — writer.ts, reader.ts, projection.ts, types.ts (source data shape matches Letta `usage_statistics`)
- All `components/observability/RunCard*`, `RateLimitsPanel*`, `SparklineSvg*`, `ScheduleEditDrawer*`, `RunNowButton*`

---

## 6. Implementation phases

(Tracked in TaskManager as task #5.)

**Phase A — ADR + docs.** *Complete with this doc + ADR 0004.* Mark archived docs in `docs/archive/`.

**Phase B — Validation spike (~45 min).** Pull `letta/letta:latest`, run it, hit `/v1/health`, create one agent, send one message, observe SSE stream, register vault MCP server, verify a tool call lands on AgenticOS's MCP server. Acceptance: round-trip works end to end.

**Phase C — Client + routes rewrite.** Delete `packages/hermes-client/`. Add `@letta-ai/letta-client`. Rewrite `lib/letta/client-singleton.ts`. Rename + rewrite the 7 surviving routes under `app/api/letta/`. Update all hooks. Update `LettaStatusChip`.

**Phase D — Curator agent provisioning.** Add `lib/skills/curator-agent.ts` that idempotently creates the Curator agent on first AgenticOS launch (with the three memory blocks + vault MCP tools attached). Replace the scheduler's dispatch target with a Letta message-send. End-to-end test: schedule fires → message dispatched → agent processes a fixture inbox item → log entry appears in `wiki/_meta/curator-log.md`.

**Phase E — Documentation + handoff.** Update `vault/wiki/Software/AgenticOS.md` with the pivot. Document the prerequisite Docker command in the AgenticOS README. Update Phase 4 design brief (`docs/phase-4-design-brief.md`) to reflect that Sandcastle remains differentiated work (Letta does not ship ephemeral coding sandboxes).

---

## 7. Risk notes

**Letta is pre-1.0.** Same risk class as the Hermes pre-1.0 dependency: breaking changes possible. Mitigations:

1. Pin `@letta-ai/letta-client` to specific minor versions in `package.json`.
2. Review the Letta changelog on each SDK upgrade.
3. The MCP-to-vault server is runtime-agnostic — if Letta needs to be replaced, the vault MCP layer survives.

**Memory blocks as inspectable state.** The `vault_conventions` block is user-visible (via Observability UI). It can also be user-edited (via the same UI, eventually). That's powerful, but it means a user error in editing memory can degrade Curator behavior. Mitigation: a "reset memory" button alongside the inspection view, and an "export memory" backup button that writes the block to `vault/wiki/_meta/curator-memory-snapshot.md`.

**Self-hosted Docker dependency.** Adds Docker to AgenticOS's prerequisite list (previously: just Node 22, pnpm). Document clearly. The alternative — Letta Cloud — is rejected for local-first reasons.

---

## 8. Open from the brainstorming-checkpoint

- [ ] Confirm Letta's TS SDK exports types for SSE event shapes; if not, add a thin wrapper for `data: {…}` parsing types in `lib/letta/event-types.ts`.
- [ ] Confirm the streaming-tokens vs streaming-steps default — UI prefers token streaming for the typing-effect render in RunCard.
- [ ] Decide whether the Curator's `vault_conventions` should be sync'd to the vault as a markdown file (via MemFS) or kept Letta-only. Phase 5+ decision.

## References

- ADR 0004 — pivot rationale: `docs/adr/0004-pivot-hermes-to-letta.md`
- ADR 0003 — scheduler ownership (affirmed): `docs/adr/0003-scheduler-ownership.md`
- Archived Hermes-shaped spec: `docs/archive/phase-3-hermes-integration.md`
- Archived v0.14.0 Hermes supplement: `docs/archive/phase-3-v0.14.0-implications.md`
- Letta docs: <https://docs.letta.com>
- Letta API reference: <https://docs.letta.com/api>
- Letta self-hosting: <https://docs.letta.com/guides/selfhosting>
- Letta MCP integration: <https://docs.letta.com/guides/agents/mcp>
- Letta streaming: <https://docs.letta.com/guides/agents/streaming>
