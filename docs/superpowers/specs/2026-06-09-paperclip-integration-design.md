# Paperclip Integration — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorming complete)
**Supersedes:** All Hermes-shaped specs (orchestrator, gateway, cron tasks)
**Related:** [ADR 0006 — Hermes to Paperclip runtime](../../adr/0006-hermes-to-paperclip-runtime.md)

---

## 1. Goal

Replace the Hermes-centered single-operator architecture with
[Paperclip](https://github.com/paperclipai/paperclip) (MIT, 70k stars) as the
agent runtime and control plane, scaling AgenticOS from 1 operator to 4 humans
(near-term) and 10–50 (eventual) while preserving the vault governance
invariants, two-brain memory model, and forester's almanac visual identity.

## 2. Scope

**In scope (Goldberry Grove company):**
- Paperclip server deployment on the DO Droplet
- Paperclip React UI on DO App Platform behind Cloudflare Access
- Vault plugin (`@agenticos/vault-plugin`)
- OpenViking plugin (`@agenticos/openviking-plugin`)
- Theme override + KPI Vista plugin UI contribution
- Role-based agent roster with multi-model adapter routing
- GitHub Issues → Paperclip sync
- Docker Compose stack migration
- Terraform updates for Droplet sizing

**Out of scope:**
- Instnt, Personal, AgenticOS-as-project domains (stay in Claude/vault ecosystem)
- GGG Woodworking and At the Grove Nursery companies (split later via export/import)
- Paperclip's planned Memory/Knowledge feature (use OpenViking until it ships)

---

## 3. Architecture

### 3.1 Deployment Topology

```
                  Browser (anywhere)
                         │
                         │ HTTPS → agenticos.gatheringatthegrove.com
                         ▼
                ┌──────────────────────────────┐
                │  Cloudflare Access            │
                │  (Google SSO perimeter gate)  │
                └────────────┬─────────────────┘
                             ▼
                ┌──────────────────────────────┐
                │  DO App Platform              │
                │  Paperclip React UI (Vite)    │
                │  + AgenticOS theme override   │
                │  + KPI Vista plugin UI        │
                └────────────┬─────────────────┘
                             │ DO VPC private network
                             ▼
                ┌────────────────────────────────────────┐
                │  DO Droplet (Terraform-managed size)   │
                │  - paperclip-server (Node.js)          │
                │  - agenticos-db (pgvector/pg15)        │
                │    └─ Paperclip 80+ tables             │
                │    └─ Legacy cost tables (until retired)│
                │  - openviking :1933 (semantic memory)  │
                │  - ollama (embeddings + local models)  │
                │  - vault-server :7779 (vault HTTP API) │
                │  - Vault filesystem (/opt/vault)       │
                │  - Tailscale + Syncthing daemons       │
                └──────────────────┬─────────────────────┘
                                   │ Tailscale mesh + Syncthing
                          ┌────────┴────────┐
                          ▼                 ▼
                  Mac (Obsidian,     Future devices
                  Syncthing)
```

### 3.2 Docker Compose Stack (post-migration)

| Service | Image | Purpose |
|---|---|---|
| `paperclip-server` | `paperclipai/paperclip:latest` (or local build) | Runtime, heartbeat scheduler, adapter dispatch, API |
| `agenticos-db` | `pgvector/pgvector:pg15` | Postgres — Paperclip tables + legacy |
| `ollama` | `ollama/ollama:latest` | Embeddings, local model serving |
| `openviking` | `ghcr.io/volcengine/openviking:v0.3.19` | Agent semantic memory |
| `vault-server` | `agenticos/vault-server:local` | Vault HTTP API, read-only enforcement |

**Retired:** `hermes-agent`, `hermes-gateway`, `inbox-watcher` (absorbed by vault plugin)

### 3.3 Authentication

Two layers:
1. **Cloudflare Access** — perimeter gate, Google SSO, zero-trust. Controls "are you allowed in at all."
2. **Paperclip auth** — `company_memberships` with roles. Controls "what can you do once inside."

### 3.4 Secrets

1Password → `setup-secrets-1password.sh` → `/opt/agenticos/.env` → Docker `env_file`.
Same chain as today. New variables added:

```
ANTHROPIC_API_KEY=...     # Claude adapter
OPENAI_API_KEY=...        # Codex adapter (existing)
DEEPSEEK_API_KEY=...      # DeepSeek/OpenCode adapter
```

---

## 4. Company Model

**Single company: "Goldberry Grove"**

Vault taxonomy (`goldberry` project tag) drives project-level organization
within the company. Future companies (GGG Woodworking, At the Grove Nursery)
split via Paperclip's `companies.sh export/import` when team boundaries exist.

Instnt, Personal, and AgenticOS domains stay outside Paperclip entirely —
they remain in the Claude/vault ecosystem.

---

## 5. Agent Roster

Role-based agents with default adapter assignments:

| Agent | Domain | Default Adapter | Notes |
|---|---|---|---|
| Farm Ops Agent | Farm scheduling, inventory, weather, operations | `claude_local` | Goldberry Grove primary |
| Dev Agent | Code PRs, architecture, repo maintenance | `codex_local` | GitHub Issues → Paperclip sync |
| Content Agent | Marketing, social, video pipeline | `claude_local` | Brand voice, content creation |
| DevOps Agent | Droplet monitoring, Terraform scaling, infra health | `codex_local` | Monitors resource pressure, proposes scaling |

### 5.1 Adapter Routing Rules

1. **Brainstorm → Claude, Execute → Codex.** Code-producing tasks get a
   two-phase pipeline: Claude handles planning/architecture (heartbeat
   "Understand context" step), Codex handles implementation ("Checkout → work →
   commit" steps).
2. **Budget threshold override.** When an agent's spend crosses a configurable
   threshold in Paperclip's budget policies, downshift from Claude to
   Codex or DeepSeek.
3. **Rate-limit cascade.** On adapter rate-limit error, fall through:
   Claude → Codex → DeepSeek.

### 5.2 Scheduled Routines

| Routine | Agent | Schedule | Adapter |
|---|---|---|---|
| PR triage | Dev Agent | Daily 07:30 ET | `codex_local` |

**Retired:** `daily_brief` (cut entirely), `cost_report` (Paperclip native).
**Absorbed:** `vault_ingest` → vault plugin internal job (no LLM needed).

---

## 6. Vault Plugin (`@agenticos/vault-plugin`)

### 6.1 Architecture

The vault plugin is an HTTP client to vault-server (`localhost:7779`). It does
NOT touch the vault filesystem directly.

### 6.2 Capabilities

| Capability | Direction | Mechanism |
|---|---|---|
| Read vault pages | vault → plugin | GET vault-server API |
| Read vault taxonomy | vault → plugin | GET vault-server API, discover tags |
| Sync skills to Paperclip | vault → `company_skills` table | Read `wiki/Skills/`, upsert to DB |
| Sync taxonomy to labels | vault → Paperclip labels | Read folder structure, upsert |
| Archive inbox items | plugin → vault | POST vault-server `/discard` endpoint |
| Surface vault content | plugin → Paperclip UI | Read-only reference panel |
| Inbox monitoring | internal job | Poll vault-server for new inbox items |

### 6.3 Skills Sync

**Source of truth:** `~/.claude/skills/<name>/SKILL.md` → mirrored to
`wiki/Skills/` → vault plugin reads from vault-server → upserts to
`company_skills` with metadata:

```json
{
  "sourceType": "vault-sync",
  "skill_origin": "vault",
  "skill_companion_dir": "~/.claude/skills/<name>/",
  "wikilinks": ["Software/AgenticOS"]
}
```

Sync is one-way: vault → Paperclip. Paperclip never writes to the vault.

### 6.4 Vault Governance Invariants (preserved)

- vault-server mounts `wiki/`/`sources/` read-only — physically enforced
- Plugin's only write path: `inbox/` archival via vault-server API
- Promotion stays human-applied in Obsidian via Syncthing delivery
- Agents draft to `inbox/` — Syncthing delivers to Mac, human promotes in Obsidian
- No three-pane Memory tab rebuild — read-only reference + archive action only

---

## 7. OpenViking Plugin (`@agenticos/openviking-plugin`)

Exposes OpenViking's semantic memory as Paperclip agent tools:

| Tool | Purpose |
|---|---|
| `viking_remember` | Store a memory with embeddings |
| `viking_recall` | Semantic retrieval by meaning |
| `viking_find` | Directory-based structured lookup |
| `viking_abstract` | Summarize/compress memory entries |

OpenViking continues running as a Docker service on the Droplet. The plugin
connects via `http://openviking:1933` (Docker network) or
`http://10.116.16.2:1933` (VPC).

Droplet sizing is Terraform-managed (`var.droplet_size`). The DevOps Agent
monitors resource pressure and proposes scaling via GitHub Issues.

---

## 8. UI Migration

### 8.1 Theme Override

Paperclip's `index.css` stays untouched. An `agenticos-theme.css` loads after
it, overriding CSS variables and adding custom components:

**Layer 1 — Brand tokens** (~200 lines):
`--ink`, `--parchment`, `--gold`, `--pine`, `--russet`, `--moss-*`,
`--copper`, `--amber`, `--sage`, `--dusk-*` families.

**Layer 2 — shadcn bridge** (~130 lines):
Maps brand tokens to `--color-background`, `--color-primary`, etc.
Both projects use Tailwind v4 + shadcn CSS variables — near-drop-in swap.

**Layer 3 — Custom component CSS** (~1370 lines):
Paper-grain texture, glass-pane cards, lane stripes, serif/sans/mono font
stacks, `.pill`, `.bar-row`, `.spark-wrap`, `.big-num`, mobile responsive,
reduced-motion fallbacks.

### 8.2 Paperclip Runtime Branding

`ui-branding.ts` configured with:
- `name`: "AgenticOS"
- `color`: `#c9a227` (gold)
- `textColor`: `#060f0b` (ink)
- `faviconHref`: AgenticOS favicon

### 8.3 KPI Vista

Ported as a Paperclip plugin UI contribution via `@paperclipai/plugin-sdk/ui`.
Animated SVG backdrops (EKG heartbeat, burndown curve, oscilloscope, memory
accumulation, skill galaxy) injected into a host extension slot.

### 8.4 Native Paperclip Views (no rebuild needed)

- **Runs** — heartbeat runs, agent activity, run logs
- **Cost** — budget policies, `cost_events`, spend tracking
- **Health** — environment monitoring
- **Settings** — admin panel

### 8.5 Deferred

- **Architecture view** — Paperclip's Skills Manager + vault taxonomy labels
  provide discoverability. Spatial layout deferred to a future plugin view.

---

## 9. GitHub Issues Integration

**GitHub Issues are canonical.** Paperclip syncs from them.

Flow:
1. Human files issue on GitHub (or agent creates one for discovered work)
2. Paperclip routine polls GitHub, imports issues into Paperclip's `issues` table
3. Heartbeat assigns issue to appropriate role-agent
4. Agent works the issue (checkout → branch → commits)
5. Result flows back as GitHub PR + issue comment
6. Human reviews/merges on GitHub

Non-code work (farm ops, content) originates as Paperclip issues directly —
no GitHub repo involved.

---

## 10. Migration Sequence (high-level)

1. **Docker Compose** — Add `paperclip-server` service, keep all existing services
2. **Database** — Run Paperclip schema migration against existing `agenticos` DB
3. **Vault plugin** — Build `@agenticos/vault-plugin`, connect to vault-server
4. **OpenViking plugin** — Build `@agenticos/openviking-plugin`
5. **Theme** — Create `agenticos-theme.css`, configure `ui-branding.ts`
6. **Agents** — Create role-based agent roster in Paperclip
7. **Adapters** — Configure `claude_local`, `codex_local`, `opencode_local`
8. **Routines** — Port PR-triage as Dev Agent scheduled routine
9. **GitHub sync** — Configure GitHub Issues → Paperclip import
10. **KPI Vista** — Port as plugin UI contribution
11. **Retire Hermes** — Remove `hermes-agent`, `hermes-gateway`, `inbox-watcher` from Compose
12. **Terraform** — Update cloud-init template, adjust `droplet_size` variable
13. **App Platform** — Deploy Paperclip React UI instead of Next.js dashboard
