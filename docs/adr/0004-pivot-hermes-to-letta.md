# ADR 0004: Pivot Phase 3 runtime from Hermes Agent to Letta

> **⚠️ SUPERSEDED (same day, 2026-05-20):** This ADR records the Hermes → Letta pivot decision made in the morning of 2026-05-20. Later that day, a foundation rebrainstorm changed the runtime + memory composition again. The current direction is captured in `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`, which selects **Claude Code (Max OAuth) + Honcho + Obsidian + DigitalOcean** instead of Letta. A future ADR 0005 will record the supersession succinctly. This document is preserved as historical decision trail.

**Status**: Superseded (same-day pivot to composed stack — see header note)
**Date**: 2026-05-20
**Supersedes**:
- Phase 3 spec (`docs/phase-3-hermes-integration.md`) §2 decisions #1, #5, #6, #7 — transport, supervision, MCP direction, auth
- `docs/phase-3-v0.14.0-implications.md` in full (Hermes-specific supplement)
- ADR 0003 §"Hermes is executor" — replaced with "Letta is executor"; the scheduler-ownership decision itself stands

## Context

Phase 3 was designed against **Hermes Agent** assumed to expose an HTTP/SSE orchestration API on `127.0.0.1:7600`. The 11 resolved decisions, the `packages/hermes-client` package, the API routes under `app/api/hermes/`, and the entire Phase 3 supplement (`phase-3-v0.14.0-implications.md`) all rested on that assumption.

First-time integration testing on **2026-05-20** falsified the assumption end-to-end. The factual sequence:

1. **Hermes installation** succeeded (`brew install hermes-agent`), but `hermes serve --port 7600` does not exist as a subcommand. The CLI exposes `chat`, `gateway`, `dashboard`, `proxy`, `mcp`, `acp`, `cron`, `webhook`, plus ~40 others — none of which is an HTTP API for orchestration.
2. **`hermes mcp serve`** is the only candidate that could expose Hermes-as-server. After patching two upstream packaging bugs (`mcp_serve.py` not bundled in the PyPI wheel; the `mcp` SDK not declared as a dependency), it ran. But MCP Inspector revealed Hermes's MCP server is **messaging-shaped**: `conversations_list`, `messages_read`, `messages_send`, `channels_list`, `events_poll`, `permissions_*`. It exposes Hermes's chat-platform bridge (Telegram/Discord/Slack/etc.) to MCP clients. It does not expose session management, runs, cron, or skills.
3. **`hermes dashboard`** at port 9119 is a complete web UI with its own backend, but that backend is a private API — no public documentation, no stability contract.
4. **`hermes proxy`** is an OpenAI-completion-compatible forwarder, not a run-management API.
5. **`hermes acp`** is a stdio JSON-RPC surface for VS Code / Zed / JetBrains editor plugins.
6. The official documentation at <https://hermes-agent.nousresearch.com/docs> lists "Programmatic Integration" as a navigation entry but ships no content there; the v0.14.0 changelog adds zero HTTP-API surface area. The architecture page mentions "API Server" as a hypothetical entry point with no implementation.

**Hermes is not designed to be orchestrated by another application.** Its design intent is to *be* the orchestrator: it ships its own CLI, gateway (22 messaging platforms), dashboard, cron scheduler, skills system (agentskills.io standard), subagent spawning, and seven execution backends (local/Docker/SSH/Modal/Daytona/Vercel Sandbox/Singularity). The "another app talks to Hermes over HTTP" slot does not exist in Hermes's product mental model.

This invalidates Phase 3's integration premise. AgenticOS's Phase 3 architecture above the transport layer is sound; the transport layer has nothing to attach to.

## Decision

**Replace Hermes with Letta (<https://letta.com>, formerly MemGPT) as Phase 3's agent runtime.**

Letta is the production-quality successor to the MemGPT research project. It is explicitly designed as a stateful-agents API: server-first, REST-shaped, with persistent memory architecture as the central thesis.

Concrete confirmations from documentation review (2026-05-20):

- **Self-hosted Docker** on port `8283` with the same loopback-only trust model AgenticOS uses for `127.0.0.1:7610` (vault MCP):
  ```
  docker run -p 8283:8283 \
    -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
    -e ANTHROPIC_API_KEY=... \
    letta/letta:latest
  ```
- **Complete REST API** at `http://localhost:8283/v1/*` covering agents (CRUD), messages (send + history), memory (blocks + archival + recall), tools, MCP server registration. Unauthenticated on localhost by default.
- **SSE streaming** at `POST /v1/agents/{id}/messages/stream` with documented event types: `reasoning_message`, `assistant_message`, `tool_call_message`, `tool_return_message`, `stop_reason`, `usage_statistics`. Standard `data: {…}\n\n` framing terminating in `data: [DONE]`.
- **Official TypeScript SDK** (`@letta-ai/letta-client` from npm) — AgenticOS does not maintain its own client wrapper. Python SDK (`letta-client`) also exists for non-dashboard integrations.
- **MCP integration** is first-class: `client.mcpServers.create({mcp_server_type: "streamable_http", server_url: "http://127.0.0.1:7610"})`. The AgenticOS vault MCP server built in Phase 3 Wave 4 attaches to Letta agents unchanged.
- **Memory is inspectable and mutable from the outside**: memory blocks (e.g., `human`, `persona`, `vault_conventions`) are first-class REST resources, not opaque internal state. This makes the "self-learning" property visible to the AgenticOS UI in a way no other runtime offers.
- **Multi-channel sharing**: Letta Code (a separate npm CLI) and `chat.letta.com` are alternate clients of the same Letta server and share agents with the AgenticOS dashboard. Equivalent to what Hermes promised for Telegram/Discord, but with agents addressable from any client.

## Alternatives considered (and rejected)

**A. Reverse-engineer the `hermes dashboard` private HTTP API.**
Brittle (private API can change at any Hermes release), fights upstream design intent, and would require ongoing reactive maintenance for every Hermes version bump. The 30-day brew-install count of 1,084 with 3 build errors indicates a project still in active churn. Rejected as long-term unsustainable.

**B. Filesystem-tail of `~/.hermes/sessions/*.json` + subprocess dispatch via `hermes chat --skills curator`.**
Functional but requires building parallel scaffolding for capabilities Hermes already provides (cron, skills, dashboard). Doubles the surface area of "things AgenticOS owns" without any architectural benefit. Rejected.

**C. Accept scope overlap with Hermes, retire AgenticOS's redundant Phase 3 features, refocus on the vault layer.**
Honest but writes off ~30-40% of merged Phase 3 work (RunCard feed, RateLimitsPanel, scheduler UI). Considered as a fallback if no orchestrable runtime existed. Rejected once Letta was identified as a clean fit — preserving AgenticOS's orchestration surface is high-value if the runtime supports it.

**D. LangGraph Platform.**
Has a real REST API for runs. Lacks first-class self-learning / persistent memory; would require designing those in. Stronger fit for explicit graph-based workflows than for autonomous agent loops. Reasonable backup if Letta validation fails, not first choice.

**E. OpenAI Assistants API.**
Cleanest documented API of all candidates, but cloud-only and locks AgenticOS to OpenAI. Violates the local-first / sovereignty principle of Goldberry Grove. Rejected.

**F. Build it ourselves on Anthropic's Claude Agent SDK.**
Most control, most work. AgenticOS becomes responsible for memory architecture, learning loops, multi-model support, persistence — all of which Letta provides as its core product. Not a reasonable use of single-developer time when a mature option exists.

## Rationale

The decision rests on five compounding factors:

### 1. Letta's API surface is the API surface Phase 3 designed against

Phase 3 spec §3.1 sketched 11 HTTP routes against a hypothetical Hermes server. The Letta API documents 10+ matching routes against a real running server. The translation table is mechanical: `POST /runs` ↔ `POST /v1/agents/{id}/messages`, `GET /runs/:id/events` (SSE) ↔ `POST /v1/agents/{id}/messages/stream` (SSE), `GET /tools` ↔ `GET /v1/tools`, etc. **The Phase 3 architecture above `packages/hermes-client` survives unchanged.**

### 2. Memory blocks are a better-than-expected fit for AgenticOS's domain

Phase 3 originally treated the Curator as a hardcoded TypeScript skill with no learning. Letta's memory blocks (`human`, `persona`, custom blocks) reshape this: the Curator becomes a persistent Letta agent whose `vault_conventions` and `taxonomy_preferences` memory blocks accumulate signal over weeks of nightly runs. The "self-learning" property the original spec aspired to but didn't implement becomes a free property of the runtime choice.

Memory inspection via `GET /v1/agents/{id}/core-memory` gives AgenticOS a UI surface that nothing else in the agent-runtime ecosystem offers: the user can read what the Curator believes about their vault, and edit it.

### 3. The vault MCP server (Wave 4) becomes more valuable, not less

The `apps/dashboard/lib/mcp-vault/` server built in Wave 4 was designed around the assumption Hermes would consume it. Letta's MCP integration consumes it identically — no code changes. AgenticOS's MCP-to-vault server is now positioned as the integration interface for any agent runtime that speaks MCP, not just Letta. If we ever swap Letta out (LangGraph Platform, OpenAI Assistants, whatever comes next), the vault server stays in place.

### 4. Official SDK eliminates a maintenance burden

`packages/hermes-client/` was going to require ongoing maintenance for every Hermes version bump — type drift, new endpoints, SSE event additions, error contract evolution. The official `@letta-ai/letta-client` npm package transfers that burden to Letta's team. AgenticOS deletes ~700 lines of client code, ~14 tests, the eventsource-parser dependency, and the `packages/hermes-client/` package entirely.

### 5. Trust model survives without modification

Phase 3 §2 decisions #5 (no AgenticOS supervision) and #7 (no auth between AgenticOS and the runtime) were predicated on loopback + same-OS-user as the trust boundary. Letta's self-hosted Docker default is loopback-only, unauthenticated. Same trust model, no rework.

## Consequences

### Code: deleted

| Path | Reason |
|---|---|
| `packages/hermes-client/` (entire package) | Replaced by `@letta-ai/letta-client` from npm |
| `apps/dashboard/lib/hermes/` | Renamed to `lib/letta/`; becomes a thin singleton wrapper around the SDK |
| `docs/phase-3-v0.14.0-implications.md` | Hermes-specific; moved to `docs/archive/` |
| `eventsource-parser` dependency | Letta SDK handles SSE parsing internally |

### Code: renamed

| Before | After | Notes |
|---|---|---|
| `apps/dashboard/app/api/hermes/*` | `apps/dashboard/app/api/letta/*` | Route shapes preserved where possible; bodies call Letta SDK |
| `apps/dashboard/lib/hooks/use-hermes-*` | `apps/dashboard/lib/hooks/use-letta-*` | Same return shapes; transport underneath changes |
| `apps/dashboard/components/observability/HermesStatusChip` | `LettaStatusChip` | Health check now targets `http://localhost:8283/v1/health` |
| `docs/phase-3-hermes-integration.md` | `docs/phase-3-letta-integration.md` | Original archived; new doc reflects Letta architecture |

### Code: survives unchanged

| Path | Why |
|---|---|
| `apps/dashboard/lib/mcp-vault/` (Wave 4) | Letta attaches it as an MCP server identically to how Hermes would have |
| `apps/dashboard/lib/scheduler/` | Dispatches messages to Letta agents via the SDK instead of HTTP to Hermes |
| `apps/dashboard/lib/limits/` | Same writer pattern; source data is Letta SSE `usage_statistics` events |
| All UI: `RunCard`, `RateLimitsPanel`, `ScheduleEditDrawer`, etc. | Data shapes match; only the data source changes |
| `apps/dashboard/instrumentation.ts` | Boots scheduler + MCP-to-vault server identically |

### Architecture: new shape

```
┌────────────────────────────────────────────────────────────────┐
│  USER MACHINE                                                  │
│                                                                │
│  ┌─────────────────────────┐    ┌──────────────────────────┐   │
│  │ AgenticOS (Next.js 16)  │    │ Letta server (Docker)    │   │
│  │                         │    │ 127.0.0.1:8283           │   │
│  │ @letta-ai/letta-client  ├───►│ /v1/agents               │   │
│  │ (server-only)           │SSE │ /v1/agents/{id}/messages │   │
│  │                         │◄───│   /stream  (SSE)         │   │
│  │ scheduler  ─────────────┤    │ /v1/agents/{id}/         │   │
│  │ (node-cron)             │    │   core-memory            │   │
│  │                         │    │ /v1/tools                │   │
│  │ MCP-to-vault server     │    │ /v1/mcp-servers          │   │
│  │ 127.0.0.1:7610          │◄───┤                          │   │
│  │ (Wave 4, unchanged)     │MCP │ (Postgres + pgvector     │   │
│  └─────────────────────────┘    │  bundled; persists to    │   │
│                                 │  ~/.letta/.persist/)     │   │
│  Vault filesystem               └──────────────────────────┘   │
│  ~/Documents/Dev Projects/                                     │
│  vault/                                                        │
└────────────────────────────────────────────────────────────────┘

Plus optional alternate clients sharing the same Letta server:
  - Letta Code CLI (npm install -g @letta-ai/letta-code)
  - chat.letta.com (browser + mobile)
  - Telegram/Slack/Discord via Letta Code's channel integrations
```

### User-facing: Letta becomes a prerequisite

Installation: `docker pull letta/letta:latest` and `docker run -p 8283:8283 -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data -e ANTHROPIC_API_KEY=... letta/letta:latest`. AgenticOS detects Letta the same way it would have detected Hermes: ping `/v1/health`, surface offline state in the UI, never manage the lifecycle.

The `agenticos doctor` script (deferred to Phase 6) will verify Letta reachability as a checked prerequisite.

### Self-learning becomes real, not aspirational

The Curator skill, originally planned as a hardcoded TS function with no memory, becomes a persistent Letta agent with the following memory blocks at creation:

- `persona` — "I am the Curator agent for Josh's vault. I classify inbox items, lint wiki links, and surface candidates for promotion."
- `human` — Stable facts about the user (name, project list, voice/conventions).
- `vault_conventions` — Evolving knowledge of taxonomy preferences, classification edge cases, and per-project rules. **Grows over time as the agent encounters ambiguous cases and resolves them.**

The Curator's nightly schedule dispatches a single message ("Process today's inbox") to the persisted agent. The agent reads via vault MCP tools, writes via vault MCP tools, updates its own memory via Letta's internal mechanisms.

Phase 4 (Sandcastle) becomes more meaningful, not less: Letta doesn't ship ephemeral coding-agent sandboxes with git-worktree isolation. That's still differentiated value for AgenticOS to build.

### Sunk cost from Hermes spelunking

Two Hermes packaging bugs were diagnosed during validation (mcp_serve.py missing from PyPI wheel; `mcp` SDK undeclared as dep). Filing both upstream at NousResearch/hermes-agent is a courtesy to the next person who hits the same issues, but no longer a prerequisite for AgenticOS work. Deferred to "spare cycles" priority.

## Open questions

- [ ] Letta's billing model for production use — Letta Cloud is metered; self-hosted is free but requires Docker. AgenticOS targets self-hosted; document in onboarding.
- [ ] Whether Letta's "MemFS" (git-tracked memory blocks syncable to GitHub) should point at a subdirectory of the Goldberry Grove vault for cross-discoverability. Promising Phase 5/6 direction; not Phase 3 work.
- [ ] Migration path if Letta's API has a breaking change pre-1.0 — the SDK abstracts most surface area, but major schema changes (e.g., memory model rework) would impact AgenticOS. Accept as the same risk class as any pre-1.0 dependency. Pin to specific minor versions in `package.json`; review the changelog on each SDK upgrade.
- [ ] Whether Phase 4 (Sandcastle) is still scoped as planned, or whether Letta's subagents + tool ecosystem subsumes part of it. Re-evaluate after Phase 3 ships with at least one Curator run.

## References

- Letta documentation: <https://docs.letta.com>
- Letta GitHub: <https://github.com/letta-ai/letta>
- Letta Code (alternate client): <https://github.com/letta-ai/letta-code>
- MemGPT paper (founding research): <https://arxiv.org/abs/2310.08560>
- Archived Hermes integration spec: `docs/archive/phase-3-hermes-integration.md`
- Archived v0.14.0 implications supplement: `docs/archive/phase-3-v0.14.0-implications.md`
- New Phase 3 integration spec: `docs/phase-3-letta-integration.md`
- ADR 0003 (scheduler ownership — affirmed, executor replaced): `docs/adr/0003-scheduler-ownership.md`
