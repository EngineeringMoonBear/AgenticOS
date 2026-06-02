# AgenticOS Foundation v2 — Design

> **⚠️ SUPERSEDED — architectural ancestor.** This design selected **Honcho**
> for memory and framed reasoning as **Claude Code (Max OAuth)**. Both have
> since changed: memory is now **OpenViking** (per the
> [2026-05-29 corrective spec](./2026-05-29-memory-vault-server-corrective-design.md)),
> and the primary reasoning provider is **openai-codex** (Codex subscription;
> Claude is a fallback). The decision trail is recorded in
> [ADR 0005](../../adr/0005-letta-to-composed-stack.md). The high-level vision
> (composed stack, two-brain memory, single dashboard) still holds. See the
> [docs index](../../README.md). Preserved for history.

**Status**: Superseded (2026-05-20; memory → OpenViking and reasoning → Codex per ADR 0005)
**Owner**: Josh (single-developer)
**Supersedes**:
- ADR 0004 (Letta pivot) — partially superseded by the new runtime + memory composition
- `docs/phase-3-letta-integration.md` — to be archived once a new ADR 0005 is written
- Phase 3 Wave 1 outputs (`packages/hermes-client/`) — deleted in implementation

A follow-on ADR (0005) will record the runtime + memory pivot succinctly; this design doc captures the full reasoning.

---

## 1. Summary

AgenticOS v1 (Phases 1-2) was designed Mac-local with a vault-centric workflow. The user's restated priorities on 2026-05-20 changed the architectural calculus:

**Hard constraints (new):**
- True 24/7 autonomous operation
- $0 marginal LLM cost beyond an existing Claude Max subscription ($100/mo, sunk cost) and DigitalOcean hosting
- A first-class "smart curated memory" layer, not a bolt-on
- Beautiful customizable dashboard remains a goal

**Foundation v2 architecture (this design):**
- **Cloud-first.** A DigitalOcean Droplet is the source of truth for vault, memory, agent runtime. The Mac is a thoughtful client.
- **Composed runtime + memory.** Claude Code (authenticated via Max OAuth, in-policy) is the agent runtime. Honcho (self-hosted, OSS) is the operational memory + user-model layer. Obsidian-format vault is the knowledge layer.
- **Hybrid deployment.** DigitalOcean App Platform hosts the AgenticOS Next.js dashboard with GitHub-driven auto-deploy. The Droplet hosts the daemons (Claude Code, Honcho, Postgres, vault, Tailscale, Syncthing). They communicate over a private DO VPC.
- **Three trust networks.** Public web (Cloudflare Access + Google SSO) for the dashboard, DO VPC private for dashboard ↔ Droplet, Tailscale mesh for Mac + Droplet + future Pi-on-LAN connectors.
- **MVP scope.** v1 ships one Curator agent + observability dashboard. Multi-agent, domain connectors (farm, smart home, networking), and beauty-pass UI are deferred to v2+.

Total marginal cost: ~$29/mo on top of Claude Max.

---

## 2. Goals and Non-Goals

### Goals (v1)

1. **One dashboard** for observability, memory inspection, cost monitoring, agent scheduling — accessible from anywhere with Google SSO.
2. **Zero additional LLM spend.** Claude Max OAuth via Claude Code is the only LLM source.
3. **24/7 autonomous Curator.** Nightly run processes vault inbox, accumulates user-model insights in Honcho.
4. **Inspectable memory.** Dashboard surfaces Honcho's user model and accumulated observations. Editable from the dashboard for course-correction.
5. **GitHub-driven deployment.** Push to `main` → both dashboard and Droplet daemons update.
6. **Composable architecture.** Each layer (vault, memory, runtime, scheduler, observability) is independently swappable.

### Non-goals (deferred)

- Multi-agent fleet (v2)
- Domain connectors: farm, smart home, networking, dev workflow (Phase 4+ connector projects, each scoped independently)
- Beauty-pass UI customization (v2)
- Local-burst Ollama for parallel cheap work (Phase 6 polish)
- Public multi-tenant hosting (never)
- LAN-resident Pi for connectors (v2, when first connector is built)

---

## 3. Constraints and tools considered

### Hard constraints

| Constraint | Implication |
|---|---|
| $0 new LLM API spend | Rules out Anthropic API, OpenAI API, Letta self-hosted with API keys, Letta Cloud |
| 24/7 autonomous | Rules out Mac-local agent runtime (laptops sleep, travel, power outages) |
| Claude Max as LLM source | Constrains runtime to Claude Code (Anthropic's intended Max-consuming surface) |
| Goldberry Grove ethos | Local-first preferred where it doesn't conflict with 24/7 |

### Tools surveyed

| Tool | Role considered | Verdict |
|---|---|---|
| **Hermes Agent** | Original Phase 3 runtime | Rejected. No orchestration API (see ADR 0004 supersession). Hermes proxy is Nous-Portal-only and strips tool calls, fatal for agent loops. |
| **Letta** | Phase 3 pivot runtime | Rejected for v2. Requires API keys (Anthropic or OpenAI) — incompatible with $0 spend constraint. Memory blocks compete with Obsidian rather than composing. |
| **Claude Code** | Runtime | **Selected.** Max-OAuth authenticated, in-policy use of subscription, MCP-native, tool-using, runs on any Linux host. |
| **Obsidian** | Knowledge layer | **Selected.** Existing investment. Markdown files. The "vault" is the canonical knowledge store. |
| **mem0** | Memory primitive | Considered. Bigger ecosystem, more commercial tilt, generic "remember things." Reasonable alternative. |
| **Honcho (Plastic Labs)** | Memory primitive | **Selected.** "Personal AI memory infrastructure," dialectic user-modeling thesis aligns with AgenticOS brand. Claude Code listed as supported MCP client. Background reasoning loop between sessions = built-in "curator-equivalent" behavior. |
| **LiteLLM** | Provider router | Rejected for v1. Letta + Claude Code each speak their providers natively; one less layer. Reconsider in v2+ if multi-provider routing becomes a goal. |
| **DO App Platform** | Dashboard host | **Selected** for dashboard layer. Auto-deploy from GitHub, managed TLS, free up to small workloads. |
| **DO Droplet** | Daemon host | **Selected** for runtime layer. App Platform can't run Claude Code / Honcho / persistent FS. |
| **Cloudflare Access** | Dashboard auth | **Selected.** Google SSO gate, free for ≤50 users, zero auth code in app. |
| **Tailscale** | Private mesh | **Selected.** Mac + Droplet + future Pis. Free for personal use, ToS-clean. |
| **Syncthing** | Vault sync Mac ↔ Droplet | **Selected.** OSS, bidirectional, file-watcher-friendly, free. |
| **DO Spaces** | Off-Droplet backup | Considered. $5/mo. Mac rsync via Tailscale is the v1 backup target; revisit if Mac storage becomes constrained. |

---

## 4. Architecture

### 4.1 Process topology

```
                     User Browser (anywhere)
                            │
                            │ HTTPS → agenticos.gatheringatthegrove.com
                            ▼
              ┌─────────────────────────────────┐
              │  Cloudflare (TLS + DDoS + WAF)  │
              │  Access gate: Google SSO        │
              │  (josh@goldberrygrove.farm)     │
              └────────────┬────────────────────┘
                           │ authenticated requests only
                           ▼
              ┌────────────────────────────┐
              │  App Platform              │  ← rebuilt on push to main
              │  AgenticOS dashboard       │     via GitHub Actions
              │  (Next.js, ~$5/mo)         │
              └────────────┬───────────────┘
                           │
                           │ DigitalOcean VPC (private IPs)
                           ▼
        ┌──────────────────────────────────────┐
        │  Droplet ($24/mo, 4GB, 80GB SSD)     │
        │                                      │
        │  Docker Compose:                     │
        │  - Honcho (FastAPI, :8000)           │
        │  - Postgres + pgvector               │
        │                                      │
        │  System services:                    │
        │  - Claude Code (Max OAuth)           │
        │  - Tailscale daemon                  │
        │  - Syncthing                         │
        │  - MCP-to-vault server (:7610)       │
        │  - systemd-timer for Curator         │
        │                                      │
        │  Filesystem:                         │
        │  - /opt/agenticos (app code)         │
        │  - /opt/vault (canonical vault)      │
        │  - /opt/backups (rolling pg_dumps)   │
        └────────┬─────────────────────────────┘
                 │
                 │ Tailscale mesh (private, encrypted)
                 ▼
   ┌──────────────────┐     ┌──────────────────────────┐
   │  Mac             │     │  Future Pi-on-LAN        │
   │  - Obsidian      │     │  - Home Assistant relay  │
   │  - Browser       │     │  - Router/UDM Pro API    │
   │  - Syncthing     │     │  - FarmOS connector      │
   └──────────────────┘     └──────────────────────────┘
```

### 4.2 Trust networks

| Network | Members | Purpose |
|---|---|---|
| Public (auth-gated) | User browser → Cloudflare → App Platform | Dashboard access from anywhere, Google SSO gate |
| DO VPC private | App Platform ↔ Droplet | Dashboard's API calls to Honcho + vault routes; no public exposure |
| Tailscale mesh | Mac, Droplet, future Pis | SSH, Syncthing, LAN-resident connectors |

### 4.3 Composition principle

Every external action by the agent is an MCP tool call. Every read by the dashboard is a REST API call. This separates read path from action path with different transports, preventing the common anti-pattern where the dashboard's API becomes a control plane the agent also calls (creates cycles).

---

## 5. Components

| Component | Where | Responsibility | New or existing |
|---|---|---|---|
| AgenticOS dashboard | App Platform | Next.js. Renders observability, memory state, costs, schedules. Calls Droplet services via VPC private IP. | Existing code, ~30% refactor |
| Cloudflare Access | Cloudflare | Google SSO gate in front of dashboard | New, config-only |
| Claude Code | Droplet | Agent runtime. Invoked as subprocess by scheduler. MCP-enabled. | New (install + OAuth) |
| Honcho | Droplet (Docker) | Agent operational memory + dialectic user model. REST API + MCP server. | New self-hosted |
| Honcho Postgres + pgvector | Droplet (Docker) | Honcho's backing store | New (bundled) |
| MCP-to-vault server | Droplet | Exposes vault tools to Claude Code via MCP | Existing (Wave 4) — ports unchanged |
| Scheduler | Droplet | systemd-timer triggers Curator nightly | Existing logic, runtime moves to Droplet |
| Vault filesystem | Droplet `/opt/vault` | Canonical knowledge base | Existing content, location moves |
| Syncthing daemon | Droplet + Mac | Bidirectional mirror of vault | New, free, ~5 min setup |
| Tailscale daemon | Droplet + Mac + future Pis | Private mesh | New, free, ~60s setup per device |

---

## 6. Data flow — Curator nightly run

```
03:00 local time
  │
  ▼
systemd-timer on Droplet fires `/opt/agenticos/scripts/run-curator.sh`
  │
  ▼
Script spawns Claude Code subprocess:
  claude --print "Process today's inbox per standing instructions"
         --mcp-config /etc/agenticos/mcp.json
         --output-format=stream-json
         --append-system-prompt-from /opt/agenticos/prompts/curator.md
  │
  ▼
Claude Code session:
  1. Reads relevant Honcho memory blocks (user model, vault conventions)
       └─ via MCP tool: honcho.get_peer_representation
  2. Lists vault inbox items older than 7 days
       └─ via MCP tool: vault.inbox.list
  3. For each item:
     a. Reads content
          └─ via MCP tool: vault.read
     b. Classifies using context from Honcho
     c. Writes log line per item
          └─ via MCP tool: vault.write (appending to wiki/_meta/curator-log.md)
     d. If novel pattern observed:
          └─ via MCP tool: honcho.add_message (with insight metadata)
  4. Returns final summary
  │
  ▼
Subprocess stdout (stream-json) parsed by run-curator.sh
  │
  ▼
Run record written to local Postgres or Honcho session log
  │
  ▼
Honcho's background loop picks up new messages, updates user model
  │
  ▼
Dashboard polls /api/agent/runs/recent — sees the new run; surfaces in feed
```

**Cost accounting:** Stream-json output includes usage events per turn. `run-curator.sh` accumulates these and writes a single run-cost record. Dashboard sums recent runs against the Max quota window for "quota remaining" display.

---

## 7. State and persistence

| State | Location | Persistence | Backup |
|---|---|---|---|
| Dashboard code | App Platform | Auto-deployed from GitHub on push | Git history |
| Droplet code | Droplet `/opt/agenticos/` | Pulled from GitHub on deploy | Git history |
| Honcho data (memory, peer rep, sessions) | Droplet Postgres volume | Docker named volume | Daily pg_dump → `/opt/backups/honcho-YYYY-MM-DD.sql` → rsync to Mac via Tailscale |
| Vault (canonical) | Droplet `/opt/vault` | Direct filesystem | Syncthing → Mac → Time Machine; weekly tar to `/opt/backups/` |
| Cron schedule | Droplet `/etc/agenticos/cron.json` | Filesystem (atomic writes, 0600) | In git in later phases |
| Rate-limit / cost log | Droplet `/var/log/agenticos/run-costs.jsonl` | Filesystem, 30-day rolling | Don't back up (regeneratable) |
| Claude Code session state | Droplet `~deploy/.claude/` | Filesystem | Optional — sessions are ephemeral |
| Tailscale + Syncthing config | Droplet | OS-managed (`/etc/tailscale/`, `~/.config/syncthing/`) | Document in install script |

**Durability test:** If the Droplet is destroyed, can we rebuild?
1. `terraform apply` (or DO console) → new Droplet in same VPC
2. SSH in, run `bootstrap.sh` from repo → installs Docker, Tailscale, Syncthing, Claude Code
3. Restore latest pg_dump → Honcho state restored
4. Syncthing rejoin from Mac → vault restored
5. App Platform unaffected (still talking to a Droplet, just a new one at a new private IP — VPC routing updates)

Total recovery time: ~30-45 min for a previously-bootstrapped operator.

---

## 8. Authentication and access

### 8.1 Dashboard (public, auth-gated)

- Custom domain: `agenticos.gatheringatthegrove.com` (CNAME → Cloudflare proxy → App Platform)
- Cloudflare Tunnel: connects Cloudflare to App Platform's `*.ondigitalocean.app` URL
- Cloudflare Access policy: requires Google SSO with email `josh@goldberrygrove.farm`
- App Platform itself: no exposed auth; trusts Cloudflare-injected headers (JWT validates request originates from Access)

### 8.2 Dashboard ↔ Droplet (VPC private)

- Both resources in same DO VPC (`agenticos-vpc`)
- Droplet exposes Honcho REST on private VPC IP only (`10.x.x.x:8000`)
- Droplet exposes vault MCP server on `127.0.0.1:7610` (loopback only — Claude Code calls it, dashboard reads vault through Honcho or via a dedicated read-only vault API route)
- App Platform env var: `HONCHO_URL=http://<droplet-private-ip>:8000`

### 8.3 Tailscale mesh (Mac, Droplet, future Pis)

- Each device runs `tailscale up` once with auth key
- Hostnames assigned: `agenticos-droplet.tailXXXX.ts.net`, `josh-mac.tailXXXX.ts.net`
- Used for: SSH from Mac to Droplet, Syncthing sync, future Pi → Droplet relay
- NOT used for: dashboard access (that's public + Cloudflare Access)
- ACLs (optional Phase 6): restrict which Tailnet devices can reach which ports

---

## 9. Cost model

| Item | Cost | Notes |
|---|---|---|
| DigitalOcean Droplet (4GB / 80GB SSD) | $24/mo | Sized for Honcho + Postgres + Claude Code + vault + headroom |
| DigitalOcean App Platform (Basic) | $5/mo | Auto-scales to $12/mo if dashboard load grows |
| Cloudflare Access | $0 | Free up to 50 users |
| Tailscale | $0 | Free for personal use up to 100 devices |
| Syncthing | $0 | OSS |
| Honcho self-hosted | $0 | OSS |
| Domain | $0 | Subdomain of existing `gatheringatthegrove.com` |
| **MARGINAL TOTAL** | **$29/mo** | On top of Claude Max ($100/mo, already paid) |

No API spend. Claude Max OAuth is the only LLM source.

---

## 10. Mapping from existing AgenticOS code

| Path | Action | Reason |
|---|---|---|
| `apps/dashboard/lib/mcp-vault/` (Wave 4) | Keep unchanged | Vault MCP server is runtime-agnostic |
| `apps/dashboard/lib/scheduler/` | Keep, adapt dispatch | Logic survives; dispatch target changes to subprocess |
| `apps/dashboard/lib/limits/` | Keep, adapt source | Source data changes from SSE to stream-json parsing |
| `apps/dashboard/lib/config/` | Keep | Config schema (project roots, vault path, model defaults) survives |
| `apps/dashboard/components/observability/RunCard*` | Keep, light rename | Data shapes match closely |
| `apps/dashboard/components/observability/RateLimitsPanel*` | Keep, retitle | Now shows Max quota + Claude Code stats |
| `apps/dashboard/lib/hermes/` | Delete + replace with `lib/agent/` | New thin layer: subprocess wrapper, Honcho REST client |
| `apps/dashboard/app/api/hermes/*` | Delete + replace with `api/agent/*` + `api/memory/*` | New route shapes for agent runs + memory inspection |
| `packages/hermes-client/` | Delete entirely | No HTTP client needed; subprocess + Honcho SDK replace it |
| `HermesStatusChip` | Replace with `AgentStatusChip` | Renders Claude Code reachability + Honcho health + Max quota |
| `docs/phase-3-letta-integration.md` | Move to `docs/archive/` | Superseded by this design + a new ADR 0005 |

Net code change: ~30% of `apps/dashboard/` touched (mostly renames + small refactors). `packages/hermes-client/` deleted entirely. New code: one `lib/agent/` module (~400 lines) plus revised API routes (~6 routes, ~600 lines total).

---

## 11. CI/CD

### 11.1 Workflow files

`.github/workflows/deploy-dashboard.yml`:
```yaml
name: Deploy dashboard to App Platform
on:
  push:
    branches: [main]
    paths: ['apps/dashboard/**', 'packages/**', 'pnpm-lock.yaml']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: digitalocean/app_action/deploy@v2
        with:
          app_name: agenticos-dashboard
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
```

`.github/workflows/deploy-droplet.yml`:
```yaml
name: Deploy daemons to Droplet
on:
  push:
    branches: [main]
    paths: ['apps/runtime/**', 'scripts/**', 'docker-compose.yml']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_TAILSCALE_HOSTNAME }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: /opt/agenticos/deploy.sh
```

Droplet's `/opt/agenticos/deploy.sh`:
```bash
#!/bin/bash
set -e
cd /opt/agenticos
git pull origin main
pnpm install --frozen-lockfile
docker compose pull
docker compose up -d --no-deps honcho postgres
sudo systemctl daemon-reload
sudo systemctl restart agenticos-runtime
```

### 11.2 GitHub secrets required

| Secret | Used in | Value |
|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | dashboard workflow | DO API token with App Platform write |
| `DEPLOY_SSH_KEY` | droplet workflow | SSH private key for `deploy@<droplet>` |
| `DROPLET_TAILSCALE_HOSTNAME` | droplet workflow | Tailscale hostname (NOT public IP) |

Note: using the Tailscale hostname for SSH requires the GitHub runner to be on the Tailnet. Two options:
- **Self-hosted GitHub runner on Mac or Droplet** (free, but adds infra)
- **Use DO API to run remote command instead of SSH** (no Tailnet membership needed)

**Recommend the latter** for MVP: GitHub Actions calls DO's `doctl compute ssh` via the API instead of opening a direct SSH connection. Keeps Droplet's SSH port firewalled to Tailscale-only.

---

## 12. Implementation phases (MVP)

| Phase | Scope | Estimated effort |
|---|---|---|
| 0. Infra provision | Droplet + VPC + App Platform skeleton, Cloudflare DNS + Access policy, custom domain | 2-3 hr |
| 1. Honcho + Claude Code | Docker-compose Honcho, verify REST, install Claude Code, OAuth via device-code, test `claude --print` | 1-2 hr |
| 2. Vault sync | Move vault to Droplet, install Syncthing on Mac + Droplet, verify bidirectional sync | 1 hr |
| 3. AgenticOS code refactor | Delete `packages/hermes-client/`, replace `lib/hermes/` with `lib/agent/`, revise API routes, retitle UI | 4-6 hr |
| 4. Curator script | `run-curator.sh`, MCP config, prompts/curator.md, test against fixture inbox | 3-4 hr |
| 5. Scheduler dispatch | Adapt scheduler to spawn subprocess, parse stream-json, write run records | 2-3 hr |
| 6. Dashboard wiring | Wire to new API routes, render Honcho memory, render Max quota + run cost | 4-6 hr |
| 7. CI/CD wiring | Both GitHub Actions workflows + secrets + test deploy | 2 hr |
| 8. End-to-end test | Real vault inbox triage night, observe, tune Curator instructions in Honcho | 1 week elapsed |

**Total contiguous work: ~20-30 hours over 2-3 weeks** single-developer-evenings.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Claude Code Max quota (~50 messages / 5h) | Dashboard surfaces quota; throttle if approaching limit; Phase 6 can add Mac-local Ollama for cheap parallel work |
| 2 | Honcho self-hosted maturity (pre-1.0) | Pin Docker image tags; review changelog before upgrading; Plastic Labs Discord for support |
| 3 | Vault sync conflicts (Droplet + Mac writing same file same minute) | Curator only writes to `wiki/_meta/curator-log.md`; Syncthing creates `.sync-conflict-` files for edge cases; Phase 6 dashboard surfaces them |
| 4 | Cloudflare Access misconfig leaving dashboard exposed | Test from incognito browser without auth cookies before declaring done; document policy in runbook |
| 5 | App Platform cost creep ($5 → $12 if more memory needed) | Acceptable; monitor; reconsider if exceeds $12/mo |
| 6 | Claude Code OAuth on remote machine (device-code flow may need periodic refresh) | Document refresh procedure in runbook; if auto-refresh fails, alert via dashboard |

---

## 14. Decisions locked from open questions

Updated 2026-05-21 — all six open questions are now locked. The only one that remains a "verify on first contact" is #1, since Honcho's exact MCP tool names can only be confirmed by running the server.

1. **Honcho MCP tool surface** — TBD until Phase 1, but spec contract: Honcho must expose tools to (a) retrieve the current peer representation / user model, (b) add a message to a session with optional insight metadata, (c) search the message history. Exact tool names will be discovered when the server starts. If Honcho's MCP surface materially differs from this contract, Phase 1 raises a blocker.

2. **Curator instructions location** — **Honcho user-model.** Initial system prompt seeds Honcho's `persona` block; subsequent refinements happen via the dialectic loop. A short `prompts/curator.md` in the repo serves as the *initial* seed but is not the source of truth at runtime.

3. **`claude-code-router` vs direct subprocess** — **Direct `claude --print` subprocess.** Simpler for MVP. Multi-model routing deferred to v2 if needed.

4. **Custom domain** — **`agenticos.gatheringatthegrove.com`.** Cloudflare proxy in front; Access policy gates with Google SSO for `josh@goldberrygrove.farm`.

5. **Backup destination** — **Mac rsync via Tailscale.** Daily pg_dump to Droplet `/opt/backups/`, then rsync to a folder on the Mac under Time Machine coverage. Revisit DO Spaces ($5/mo) only if Mac storage becomes constrained.

6. **GitHub Actions → Droplet connectivity** — **Public SSH with UFW restricted to GitHub Actions runner IP ranges.** GitHub publishes the list at `https://api.github.com/meta`; a small daily cron on the Droplet refreshes UFW rules from that list. Simpler than self-hosted runner or DO API SSH.

---

## 15. Deferred to future phases

**v2 candidates:**
- Multi-agent fleet (second agent picking up another job from priority list)
- Beauty-pass UI customization
- Memory editing UI in dashboard (let user correct Honcho's beliefs)
- Conflict-detector for Syncthing sync issues
- Vault GraphQL or richer API for cross-cutting queries

**Phase 4+ connector projects** (each its own brainstorm):
- Smart home / Home Assistant integration (LAN-resident Pi enables this)
- Farm / FarmOS connector
- Networking / UDM Pro API
- Development workflow (project status, PR triage, vault notes from coding sessions)

**Phase 6 polish:**
- Mac-local Ollama fallback for cheap parallel work
- `agenticos doctor` runbook script
- `launchd` / `systemd` daemon supervision improvements
- Automated runbook for "Droplet died, recreate from backups"

---

## 16. References

- ADR 0003 — Scheduler ownership: `docs/adr/0003-scheduler-ownership.md` (affirmed, executor changed)
- ADR 0004 — Hermes → Letta pivot: `docs/adr/0004-pivot-hermes-to-letta.md` (partially superseded)
- Archived Hermes-shaped spec: `docs/archive/phase-3-hermes-integration.md`
- Archived v0.14.0 Hermes supplement: `docs/archive/phase-3-v0.14.0-implications.md`
- (To be moved to archive on approval) Letta-shaped spec: `docs/phase-3-letta-integration.md`
- Honcho: <https://docs.honcho.dev> — <https://github.com/plastic-labs/honcho>
- mem0: <https://docs.mem0.ai> (considered, not selected)
- Claude Code: <https://docs.anthropic.com/en/docs/claude-code>
- DO App Platform GitHub Actions: <https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-github-actions/>
- Tailscale: <https://tailscale.com>
- Syncthing: <https://syncthing.net>
- Cloudflare Access: <https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/>
