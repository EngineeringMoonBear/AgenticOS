# AgenticOS Documentation Index

A status map of the design docs so readers land on the live ones. Specs and
plans accumulated through several pivots (Hermes → Letta → composed stack;
Honcho → OpenViking; Claude Max → Codex), so most older docs carry a
**SUPERSEDED** banner. Start here.

## Current authoritative docs — read these

| Doc | Purpose |
|---|---|
| [`superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) | **CURRENT.** vault-server + the vault-driven Memory tab (`MemoryTree` / `MemoryReader` / `MemoryRail` / `InboxQueue` over `/api/vault/*`). Reverted the OpenViking-premise Memory UI. |
| [`superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md) | **CURRENT.** Inbox promote/discard write model: discard archives `inbox/ → inbox/archived/` (only sanctioned cloud write); promote is human-applied in Obsidian via `obsidian://` deep link. |
| [`plans/spec1-orchestrator.md`](plans/spec1-orchestrator.md) | **CURRENT.** Runtime: Dockerized Hermes + OpenViking + Codex + Ollama + Postgres cost ledger. |

## Specs

| Doc | Status | Purpose |
|---|---|---|
| [`superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) | Current | vault-server + vault-driven Memory tab. |
| [`superpowers/specs/2026-06-01-inbox-write-surface-design.md`](superpowers/specs/2026-06-01-inbox-write-surface-design.md) | Current | Inbox promote/discard write surface. |
| [`superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md`](superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md) | Current | Spec 1 — orchestrator + cost observability (still the runtime baseline). |
| [`superpowers/specs/spec1-verified-api-shapes.md`](superpowers/specs/spec1-verified-api-shapes.md) | Current | Verified API shapes backing Spec 1. |
| [`superpowers/specs/2026-05-25-v2-unified-dashboard-design.md`](superpowers/specs/2026-05-25-v2-unified-dashboard-design.md) | Mostly current; §5.6–5.8 superseded | Unified dashboard shell + tabs. The Memory-tab sections were reverted to vault-driven by the 2026-05-29 corrective. |
| [`superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md) | Superseded | Architectural ancestor. Honcho memory + Claude Max reasoning, both since changed (OpenViking; Codex). |

## Plans

| Doc | Status | Purpose |
|---|---|---|
| [`plans/spec1-orchestrator.md`](plans/spec1-orchestrator.md) | Current | Runtime build plan (Hermes/OpenViking/Codex). |
| [`plans/v2-unified-dashboard.md`](plans/v2-unified-dashboard.md) | Mostly current; **Phase 4 superseded** | Dashboard build plan. Phases 0–3.5 apply; Phase 4 builds the deleted Viking-premise Memory tab. |
| [`plans/phase-2-vault-memory.md`](plans/phase-2-vault-memory.md) | Partially superseded | vault-core / Memory lineage valid; the Sonnet auto-commit promote is reversed by the 2026-06-01 inbox spec. |
| [`plans/phase-1-mvp-foundation.md`](plans/phase-1-mvp-foundation.md) | Superseded | Early all-mock dashboard scaffold. |
| [`plans/phase-3-hermes-integration.md`](plans/phase-3-hermes-integration.md) | Superseded | Wrong Hermes wiring (port 7600, dashboard node-cron, MCP 7610). |
| [`plans/foundation-v2-mvp.md`](plans/foundation-v2-mvp.md) | Historical | foundation-v2 MVP plan (Honcho/Claude-Max era). |

## Architecture Decision Records

ADRs live in [`adr/`](adr/) in sequence. The current decision is **0005**.

| ADR | Status | Purpose |
|---|---|---|
| [`adr/0001-state-management.md`](adr/0001-state-management.md) | Accepted | Client state management choice. |
| [`adr/0002-ui-library.md`](adr/0002-ui-library.md) | Accepted | UI library choice. |
| [`adr/0003-scheduler-ownership.md`](adr/0003-scheduler-ownership.md) | Accepted (executor changed) | AgenticOS owns schedules; runtime executes. |
| [`archive/0004-pivot-hermes-to-letta.md`](archive/0004-pivot-hermes-to-letta.md) | Superseded (archived) | Hermes → Letta pivot. Letta never adopted. |
| [`adr/0005-letta-to-composed-stack.md`](adr/0005-letta-to-composed-stack.md) | **Accepted (current)** | Letta → composed stack (Hermes + OpenViking + Codex). Supersedes 0004. |

## Archive

[`archive/`](archive/) holds superseded designs preserved as decision trail —
the Hermes-shaped and Letta-shaped Phase 3 docs and ADR 0004. See
[`archive/README.md`](archive/README.md). Do not use them as current spec.

## Other docs

- [`information-architecture.md`](information-architecture.md) — IA spec (partially stale; full rewrite deferred to a Phase-6 pass).
- [`brand.md`](brand.md) — brand voice + visual identity.
- `phase-{4,5,6}-design-brief.md` — forward-looking briefs, to be re-scoped.
