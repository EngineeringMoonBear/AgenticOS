# AgenticOS

One pane of glass for an autonomous AI agent fleet — observability, memory, cost, scheduling — built for the agent-runtime ecosystem of 2026.

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Status](https://img.shields.io/badge/status-implementing--v1-blue)
![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%C2%B7%20pnpm%20%C2%B7%20Turborepo-black)

## What it is

AgenticOS is the orchestration dashboard for a single-developer agent fleet. It surfaces what your agents are doing, what they've learned about you, how much they're costing, and when they'll next run.

The architecture is intentionally a composition of best-in-class components rather than a monolith:

AgenticOS runs a **two-brain memory model** — a human brain and an agent brain, kept deliberately separate:

- **Human memory (the vault)** — an Obsidian-format vault on disk (`wiki/`, `+inbox/`, `+sources/`). Markdown files, wiki links, taxonomies. The vault is canonical human knowledge; Obsidian on the Mac is a read/write view of it via Syncthing — the Droplet never runs Obsidian itself. On the Droplet the vault lives at `/opt/vault` and is served by **vault-server** (Fastify, VPC `10.116.16.2:7779 → 7777`); the dashboard's **Memory tab** is a vault-driven three-pane browser reading it through `/api/vault/*`. This is the only memory surfaced in the Memory tab.
- **Agent memory / observability (OpenViking)** — [OpenViking](https://github.com/volcengine/OpenViking) (open-source context database by Volcengine / ByteDance) with filesystem-paradigm URIs (`viking://resources/…`, `viking://user/memories`, `viking://agent/skills`), L0/L1/L2 tiered loading, hybrid directory + semantic retrieval, and automatic memory extraction into 6 categories on session commit. OpenViking is one of the [memory providers Hermes ships with](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers) — set `memory.provider: openviking` in `config.yaml` and the agent's memory tools (`viking_remember`, `viking_recall`, `find`, `abstract`, …) are wired natively. Viking runs on the Droplet (VPC `:1933`) alongside Hermes and uses local Ollama for its own embedding + summarization pipelines. **OpenViking is the agent's working memory — it belongs to observability, not the Memory tab, and is not the vault.**
- **Agent runtime** — [Hermes Agent](https://github.com/NousResearch/hermes-agent) (headless orchestrator) running on a two-provider configuration: **main reasoning** on `provider: openai-codex` (OAuth via ChatGPT account, flat subscription cost — what we run today) with `gpt-5-codex` for heavy work and `gpt-4o-mini` for Hermes-internal routing; **auxiliary tasks** (embeddings, vision, compression) routed via Hermes' `auxiliary.*.provider` config to a `provider: custom` endpoint pointed at local Ollama (`nomic-embed-text` + `qwen2.5:3b`). Hermes supports [40+ model providers](https://hermes-agent.nousresearch.com/docs/integrations/providers) — switching the main model to Claude (`anthropic`), Gemini (`gemini`), OpenRouter (`openrouter`), or any of the others is a config change in `model.provider`, not a code change.
- **Vault tools** — an MCP-to-vault server (in this repo, `apps/dashboard/lib/mcp-vault/`) exposing the vault to any MCP-capable agent.
- **Dashboard** — Next.js 16 + shadcn/ui, deployed on DigitalOcean App Platform with auto-deploy on `push to main`.
- **Auth** — Cloudflare Access (Google SSO) in front of the public dashboard URL.
- **Private networking** — two coexisting private paths. The **DO VPC** (`10.116.16.0/20`; Droplet at `10.116.16.2`) is the private path from the App Platform dashboard to the Droplet's stateful services (UFW gates Postgres `:5432`, OpenViking `:1933`, and vault-server `:7779` to the VPC range). **Tailscale** is the admin mesh — SSH, the Syncthing GUI on `tailscale0`, and future LAN-resident devices.

## Architecture (v1)

```
                  Browser (anywhere)
                         │
                         │ HTTPS → agenticos.gatheringatthegrove.com
                         ▼
                ┌──────────────────────────────┐
                │  Cloudflare Access           │
                │  (Google SSO gate)           │
                └────────────┬─────────────────┘
                             ▼
                ┌──────────────────────────────┐
                │  DO App Platform             │ ← auto-deploy on push to main
                │  AgenticOS dashboard         │
                └────────────┬─────────────────┘
                             │ DO VPC private network
                             ▼
                ┌────────────────────────────────────────┐
                │  DO Droplet                            │
                │  - Hermes Agent (cron + orchestrator)  │
                │    → OpenAI Codex API (reasoning)      │
                │  - OpenViking :1933 (agent memory)     │
                │  - Ollama (embeddings + lightweight)   │
                │  - Postgres :5432 (tasks + cost ledger)│
                │  - vault-server :7779 (human vault API)│
                │  - Vault filesystem (/opt/vault)       │
                │  - Tailscale + Syncthing daemons       │
                └──────────────────────┬─────────────────┘
                                       │ Tailscale mesh
                          ┌────────────┴────────────┐
                          ▼                         ▼
                  Mac (Obsidian,           Future Pi-on-LAN
                  browser, Syncthing)      (Phase 4+ connectors)
```

The full design lives in
[`docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](docs/superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md).

## Status

**Foundation v2 spec approved. v1 implementation in planning.**

Phases 1–2 (vault editor, lint, taxonomy, MCP-to-vault server) are merged. Phase 3 originally targeted Hermes Agent as runtime, then pivoted to Letta, then pivoted to the current composed stack. The full decision trail is preserved in [`docs/archive/`](docs/archive/) and [`docs/adr/`](docs/adr/).

**v1 (MVP) scope:**

- One Curator agent — nightly vault inbox triage, accumulating a user model as markdown in the Obsidian vault (served to the Memory tab by vault-server; the agent's own working memory lives in OpenViking)
- Dashboard observability — runs (live + scheduled + stuck-detection), costs (burndown + projection), agent-memory telemetry (OpenViking), system health, skills catalog; plus a vault-driven Memory tab
- GitHub Actions CI/CD — push to `main` deploys both App Platform and Droplet

**Deferred to v2 and beyond:**

- Multi-agent fleet
- Domain connectors (smart home / farm / networking / dev workflow)
- UI customization pass
- Local-burst Ollama for cheap parallel work on Mac

## Repository

```
apps/
└── dashboard/                  # Next.js 16 dashboard (App Platform target)

packages/
├── vault-core/                 # markdown parse, frontmatter, lint, taxonomy
└── config/                     # shared eslint + tsconfig

docs/
├── superpowers/specs/          # current design specs (start here)
├── adr/                        # architecture decision records
├── archive/                    # superseded designs preserved for history
├── brand.md                    # brand voice + visual identity
├── information-architecture.md # IA spec for the dashboard
└── phase-{4,5,6}-design-brief.md  # forward-looking briefs (to be re-scoped per v2+)
```

`packages/hermes-client/` exists in the current main branch and will be deleted during v1 implementation — see the foundation v2 spec for the migration plan.

## Documentation

Start with the **[docs index](docs/README.md)** for a status table of every spec/plan (Current / Superseded / Archived).

- **Current authoritative specs**:
  - [`docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md`](docs/superpowers/specs/2026-05-29-memory-vault-server-corrective-design.md) — vault-server + vault-driven Memory tab
  - [`docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md`](docs/superpowers/specs/2026-06-01-inbox-write-surface-design.md) — inbox promote/discard write model
- **Runtime**: [`docs/plans/spec1-orchestrator.md`](docs/plans/spec1-orchestrator.md) — Hermes (Docker) + OpenViking + Codex cost
- **ADR 0003**: [Scheduler ownership](docs/adr/0003-scheduler-ownership.md) — affirmed (executor changed)
- **ADR 0004**: [Hermes → Letta pivot](docs/archive/0004-pivot-hermes-to-letta.md) — superseded; archived as decision trail
- **ADR 0005**: [Letta → composed stack](docs/adr/0005-letta-to-composed-stack.md) — current; supersedes 0004
- **Archive**: [`docs/archive/`](docs/archive/) — Hermes-shaped and Letta-shaped Phase 3 designs

## Prerequisites for running v1

Once v1 is implemented, you'll need:

- DigitalOcean account (Droplet + App Platform — ~$29/mo marginal)
- ChatGPT Pro/Plus account for Codex OAuth (~$20/mo flat — no per-token billing in this mode)
- Tailscale account (free tier)
- Cloudflare account (free tier; Access requires only the free plan)
- A Mac with Obsidian for vault editing
- A custom domain for the dashboard

**Cost envelope today: ~$49/mo total.** Main reasoning runs on `provider: openai-codex` (OAuth via ChatGPT Pro — flat ~$20/mo, no per-token charges). Local Ollama (`provider: custom` on the Droplet) handles all embeddings + OpenViking's background pipelines (TreeBuilder, Compressor, IntentAnalyzer) — verified during Phase 1 against `nomic-embed-text` + `qwen2.5:3b` on the 4 GB RAM Droplet — at zero marginal cost. The dashboard's Cost tab tracks any per-token spend if you swap into a metered provider later.

**Hermes supports 40+ providers** via `model.provider` config. Cheap subset for this project's likely-future swaps:

| Provider value | Auth | Cost model | When you'd switch |
|---|---|---|---|
| `openai-codex` *(current)* | ChatGPT account OAuth | ~$20/mo flat | Today's default — best $/token at our usage |
| `anthropic` | Claude Code Max OAuth or API key | ~$100/mo Max tier OR per-token API | Want Claude's reasoning at scale |
| `openrouter` | `OPENROUTER_API_KEY` | Per-token across 100+ models | Want fast A/B between models without re-auth |
| `openai-api` | `OPENAI_API_KEY` | Per-token | Need a model not on Codex (e.g. fine-tuned) |
| `gemini` / `google-gemini-cli` | API key / OAuth | Generous free tier | Experimenting with Gemini |
| `custom` (Ollama Cloud, vLLM, llama.cpp) | Optional | Self-hosted / free | Self-hosted model parity |

Each is a `model.provider` change in `/opt/agenticos/hermes-config/config.yaml` plus a credential and restart. No code in this repo needs to move.

## Development

```bash
pnpm install
pnpm dev          # dashboard at http://localhost:3000
pnpm test         # vitest across all packages
pnpm typecheck
pnpm lint
```

Requires Node ≥20 and pnpm ≥9.

⚠️ Next.js 16 has breaking changes from earlier versions. See `apps/dashboard/AGENTS.md` and `node_modules/next/dist/docs/` before assuming v15 patterns apply.

## Contributing

This is a single-developer project. Issues and discussion are welcome; PRs are not yet supported with review SLAs.

## License

MIT — see [LICENSE](LICENSE).

---

*Built with care by [Goldberry Grove](https://goldberrygrove.farm).*
