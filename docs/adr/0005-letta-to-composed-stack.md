# ADR 0005: From Letta to a composed stack (Hermes + OpenViking + Codex)

**Status**: Accepted
**Date**: 2026-05-29
**Supersedes**: [ADR 0004 — Hermes → Letta pivot](../archive/0004-pivot-hermes-to-letta.md) (Letta was never adopted)
**Related specs**:
- [2026-05-20 foundation-v2 design](../superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md) (architectural ancestor — Honcho + Claude Max, both since changed)
- [2026-05-22 Spec 1 — orchestrator + cost observability](../superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md)
- [2026-05-29 memory / vault-server corrective design](../superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md)
- [2026-06-01 inbox write-surface design](../superpowers/specs/2026-06-01-inbox-write-surface-design.md)

## Context

ADR 0004 (morning of 2026-05-20) pivoted the Phase 3 runtime from Hermes Agent
to **Letta**, after integration testing showed Hermes exposed no orchestration
HTTP API. That decision was reversed the **same day**: a foundation rebrainstorm
reframed AgenticOS around 24/7 autonomous operation at near-zero marginal LLM
spend, and produced the foundation-v2 design — **Claude Code (Max OAuth) +
Honcho + Obsidian + DigitalOcean**. **Letta was never adopted.**

The foundation-v2 composition then evolved further during implementation:

- **Memory: Honcho → OpenViking.** Honcho was never adopted. The agent memory
  store became **OpenViking** (filesystem-paradigm `viking://` URIs, L0/L1/L2
  tiered loading, local-Ollama embeddings), wired as a native Hermes memory
  provider. The human knowledge brain stayed an **Obsidian-format vault** served
  by **vault-server**. This two-brain split — vault (human) vs. OpenViking
  (agent) — is fixed by the 2026-05-29 corrective spec, which also reverted the
  Memory tab to be vault-driven.
- **Reasoning: Claude Max → openai-codex.** The primary reasoning provider is
  now **openai-codex** (`gpt-5-codex` for heavy work, `gpt-4o-mini` for light
  routing) on a ChatGPT/Codex subscription. Hermes' provider config remains
  swappable, so Claude Code/Max is retained as a fallback, not the default.
- **Runtime: Hermes (returned).** Hermes came back as the orchestrator — but run
  as a headless Dockerized service on the Droplet (orchestration, cron tick via
  hermes-gateway, cost telemetry), rather than orchestrated over an HTTP API
  that does not exist. Letta and Sandcastle are both abandoned.

## Decision

Adopt the **composed stack** as the standing architecture:

- **Agent runtime** — Hermes Agent (`agenticos-hermes` wrapper, Docker on the
  Droplet) for orchestration, cron, and cost telemetry.
- **Agent memory** — OpenViking (`:1933`), the Hermes memory provider.
- **Human memory** — Obsidian vault on `/opt/vault`, Syncthing-paired Mac ↔
  Droplet, served by vault-server (`:7779 → 7777`) to the dashboard's
  vault-driven Memory tab via `/api/vault/*`.
- **Reasoning provider** — openai-codex (primary); other providers (Anthropic,
  Gemini, OpenRouter, …) remain a config-only switch.
- **Cost envelope** — Codex subscription + DigitalOcean (~$29–49/mo). No
  per-token LLM billing in the default configuration.

**Letta is abandoned** (never adopted). **Sandcastle is abandoned** (not a
current lane). **Honcho is abandoned** (never adopted).

## Consequences

- ADR 0004 and the Letta-shaped Phase 3 spec are archived under `docs/archive/`
  as decision trail; they are not current specification.
- The foundation-v2 design is marked Superseded — its high-level vision (composed
  stack, single dashboard) holds, but its Honcho + Claude Max specifics do not.
- The MCP-to-vault interface and the dashboard's orchestration surface survive
  the pivots; the data source underneath changed, not the product shape.
- New work follows the two current authoritative specs: the 2026-05-29 corrective
  design (Memory tab / vault-server) and the 2026-06-01 inbox write-surface
  design (human-applied promote, discard-only cloud write). See the
  [docs index](../README.md).
