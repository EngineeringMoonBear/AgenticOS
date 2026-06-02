# Archived design docs

Documents preserved here as historical context. They were superseded by later decisions and **should not be used as current specification**. See the noted superseder for the current state.

| Doc | Status | Superseded by |
|---|---|---|
| `phase-3-brainstorming-checkpoint.md` | First Phase 3 brainstorm against Hermes Agent as runtime. Predates both pivots. | foundation-v2 design + ADR 0005 |
| `phase-3-hermes-integration.md` | Original Phase 3 spec designed against Hermes Agent as runtime. Falsified by integration testing on 2026-05-20 — Hermes ships no orchestration API. | `phase-3-letta-integration.md` + `0004-pivot-hermes-to-letta.md` (both also archived here) |
| `phase-3-v0.14.0-implications.md` | Supplement to the Hermes-shaped Phase 3 spec, capturing v0.14.0-specific schema changes (handoff legs, subgoal stack, cache metrics). Most concepts (memory blocks, learning loop, persistent agents) carry over in different shapes. | `phase-3-letta-integration.md` + ADR 0004 (also superseded — see below) |
| `phase-3-letta-integration.md` | The Letta-shaped Phase 3 spec (morning of 2026-05-20). Letta was **never adopted**. | foundation-v2 design + `0005-letta-to-composed-stack.md` |
| `0004-pivot-hermes-to-letta.md` | ADR recording the Hermes → Letta pivot. Same-day superseded; Letta was never adopted. | `docs/adr/0005-letta-to-composed-stack.md` |

**Same-day superset:** Both ADR 0004 (Hermes → Letta) and `phase-3-letta-integration.md` were superseded later on 2026-05-20 by `docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`, which pivoted to **Claude Code (Max OAuth) + Honcho + Obsidian + DigitalOcean**. **Note:** that foundation-v2 design named **Honcho** as the memory layer, but Honcho was likewise never adopted — the project later settled on **OpenViking** as the agent memory store (per `docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`), with **openai-codex** as the primary reasoning provider. The full decision trail Letta → composed stack → OpenViking + Codex is recorded in `docs/adr/0005-letta-to-composed-stack.md`.

The git history preserves the full evolution. These archived copies exist so the conceptual reasoning of the abandoned designs remains readable without spelunking through revisions.
