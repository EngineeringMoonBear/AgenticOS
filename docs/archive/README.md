# Archived design docs

Documents preserved here as historical context. They were superseded by later decisions and **should not be used as current specification**. See the noted superseder for the current state.

| Doc | Status | Superseded by |
|---|---|---|
| `phase-3-hermes-integration.md` | Original Phase 3 spec designed against Hermes Agent as runtime. Falsified by integration testing on 2026-05-20 — Hermes ships no orchestration API. | `docs/phase-3-letta-integration.md` + `docs/adr/0004-pivot-hermes-to-letta.md` |
| `phase-3-v0.14.0-implications.md` | Supplement to the Hermes-shaped Phase 3 spec, capturing v0.14.0-specific schema changes (handoff legs, subgoal stack, cache metrics). Most concepts (memory blocks, learning loop, persistent agents) carry over to Letta in different shapes. | `docs/phase-3-letta-integration.md` + ADR 0004 (also superseded — see below) |

**Same-day superset:** Both ADR 0004 (Hermes → Letta) and `docs/phase-3-letta-integration.md` (still in `docs/`, not yet moved here) were also superseded later on 2026-05-20 by `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`, which pivots to **Claude Code (Max OAuth) + Honcho + Obsidian + DigitalOcean**. The Letta-spec move to this archive directory is part of the foundation-v2 implementation; it remains in `docs/` for now with a SUPERSEDED header.

The git history preserves the full evolution. These archived copies exist so the conceptual reasoning of the abandoned designs remains readable without spelunking through revisions.
