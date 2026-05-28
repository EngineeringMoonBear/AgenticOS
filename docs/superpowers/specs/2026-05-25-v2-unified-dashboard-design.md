# AgenticOS v2 — Unified Dashboard Design

**Spec date:** 2026-05-25
**Status:** approved (brainstorm complete, awaiting implementation plan)
**Supersedes:** none (extends Spec 1, does not replace)
**Prior art:** [Spec 1 — orchestrator + cost observability](./2026-05-22-spec1-orchestrator-cost-observability-design.md), [foundation v2 design (architectural ancestor)](./2026-05-20-agenticos-foundation-v2-design.md)

---

## 1. Goal

Turn the working Spec 1 stack (Hermes + OpenViking + Codex + Ollama + Postgres cost ledger) into the **one pane of glass** AgenticOS was originally pitched as — observability, memory inspection, cost, and agent monitoring in a single dashboard — **without adding any new paid service**. The cost envelope remains Claude Max + DigitalOcean only.

The user-stated priority list this design serves:

- **High** — One dashboard for observability + memory + cost + agent monitoring.
- **High** — No new cost beyond Claude Max + DO.
- **High** — Smart curated memory + autonomous 24/7 tasks.
- **Medium** — Beautiful customizable UI/UX the user can extend.
- **Medium** — Prioritize work between local and cloud agents.
- **Medium** — Manages farm, smart home, networking, dev workflows.

This spec lands the **High** items in full and lays groundwork for the **Medium** items without scope-creeping them.

## 2. Scope check

This spec is a single coherent feature: extend the dashboard from "live-ops only" to "live-ops + memory inspection, both first-class". It does not fork into independent subsystems and is sized for a single-developer plan of roughly 20–30 hours over 2–3 weeks.

## 3. Locked decisions (from brainstorm)

| # | Question | Decision |
|---|----------|----------|
| 1 | Memory layer | **OpenViking** (volcengine/OpenViking). Hermes has a first-class Viking memory provider, so no bespoke MCP plumbing. Honcho is not used. mem0 is not used. |
| 2 | Human authoring layer | **Obsidian on Mac**, against a markdown vault. Obsidian is the long-term structure, taxonomy, and storage for *resources and finished skills*. Obsidian never runs on the Droplet. |
| 3 | Vault ↔ Viking sync direction | **One-way ingestion**: vault → Viking. Auto-extracted memory stays in Viking and is surfaced via the dashboard's Memory tab. |
| 4 | Ingestion cadence | **Hourly cron job**, run by Hermes (not a Node scheduler, not inotify). Hash-based dedup so unchanged files cost nothing. |
| 5 | Dashboard layout | **D3 — equal-weight tabbed** (Live-ops tab and Memory tab) with a shared header for always-relevant status (cost burn, agent health, Max quota). |
| 6 | Retrieval trajectories | **Included in v1**, not deferred. `react-force-graph-2d` is already a dashboard dep; wire it to Viking's DebugService observer output. |
| 7 | Viking LLM provider | **Ollama** (local, OpenAI-compatible API at `http://ollama:11434/v1`) for both embeddings and VLM. No external API spend. |

> **Production-reality update (2026-05-28):** SSH probe of the live Droplet (`159.223.171.231`) found the deployed `OpenViking v0.3.19` already has Ollama-backed embedding wired in `/opt/agenticos/openviking-config/ov.conf` (`nomic-embed-text`). The config file is **JSON**, not YAML, and is read by the container via the `OPENVIKING_CONFIG_FILE` env. There is no explicit `vlm:` block; Viking v0.3.19 picks up `OLLAMA_BASE_URL` from compose env for chat/generation. Viking listens on port `1933` (not 7333). All `/api/v1/*` data calls require tenant headers `X-OpenViking-Account: agenticos` and `X-OpenViking-User: deploy`. RAM constraint (3.9 GB total) limits VLM to `qwen2.5:3b` — the 7b/14b targets in §9 are infeasible without a Droplet upsize. The live OpenAPI is snapshotted at `docs/reference/openviking-v0.3.19-openapi.json` and is the source of truth for endpoint shapes below.
>
> **WebDAV considered and rejected:** Viking exposes `/webdav/resources` — in theory Obsidian could mount this directly, bypassing the cron-ingester layer. Rejected because: (a) the WebDAV path exposes Viking's internal AGFS layout, not a clean publisher API; (b) Obsidian needs a stable filesystem vault layout — Viking may rewrite paths on indexing; (c) the indirection layer is *valuable* — it lets the local vault contain drafts and unfinished content that aren't pushed to Viking. Locked decision #3 (one-way ingestion via cron) stands.

## 4. Architecture (delta over Spec 1)

```
                        ┌────────────────────────────────────┐
                        │  Mac · Obsidian (human authoring)  │
                        │   skills, taxonomies, documents     │
                        └────────────────┬────────────────────┘
                                         │ Syncthing
                                         ▼
                        ┌────────────────────────────────────┐
                        │  Droplet · /opt/vault/  (markdown) │
                        └────────────────┬────────────────────┘
                                         │ NEW: hourly Hermes cron
                                         │ "vault-ingest" job
                                         │ Viking.add_resource() per
                                         │ changed file (hash dedup)
                                         ▼
                ┌────────────────────────────────────────────┐
                │  Droplet · OpenViking (AGFS + vector idx)  │
                │   viking://resources/   ← ingested          │
                │   viking://agent/skills/  ← ingested        │
                │   viking://user/memories/   ← extracted     │
                │   viking://agent/memories/    by Viking     │
                │  LLM provider: Ollama (OpenAI-compat)       │
                └────────────────┬───────────────────────────┘
                                 │ Hermes first-class Viking provider
                                 │ (viking_remember, viking_recall,
                                 │  find, abstract, overview, observer)
                                 ▼
                ┌────────────────────────────────────────────┐
                │  Agents (Hermes-orchestrated)              │
                │   Curator, daily-brief, cost-report, etc.  │
                └────────────────┬───────────────────────────┘
                                 │ Postgres ledger
                                 │ (tasks, sessions, calls, budget)
                                 │ + Viking REST/MCP
                                 ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Dashboard (Next.js 16, DO App Platform)                   │
        │  ┌────────────────────────────────────────────────────┐    │
        │  │  Shared header: cost burn · agent health · quota   │    │
        │  ├──────────────────────────┬─────────────────────────┤    │
        │  │  Tab: Live-Ops           │  Tab: Memory            │    │
        │  │  - live runs feed        │  - browse by category   │    │
        │  │  - cost burn-down chart  │  - L0/L1/L2 progressive │    │
        │  │  - agent health panel    │    disclosure           │    │
        │  │  - queue depth           │  - retrieval trajectory │    │
        │  │  - recent errors         │    graph (force-graph)  │    │
        │  └──────────────────────────┴─────────────────────────┘    │
        └────────────────────────────────────────────────────────────┘
```

What is new in v2 versus what already exists in Spec 1:

| Component | Spec 1 state | v2 state |
|-----------|--------------|----------|
| Cost ledger (tasks/sessions/calls/budget) | shipped | unchanged |
| Hermes cron + jobs.json | shipped | one new job: `vault-ingest` |
| Viking client + `/api/v1/search/find` | shipped | extended with new endpoints (see §6) |
| Dashboard shell | single-tab observability | tabbed shell, shared header |
| Live-ops view | partially shipped | promoted to first-class tab, polished |
| Memory view | absent | new tab — browse, drill in, see trajectories |
| Vault → Viking ingestion | manual / ad hoc | hourly cron, hash-deduped |
| Viking LLM config | not finalized | locked to Ollama OpenAI-compat |

## 5. Components

Each component is sized so that one well-bounded file (or small set of files) owns its responsibility, with clear inputs and outputs.

### 5.1 Vault → Viking ingester

**File:** `packages/agenticos-hermes/src/agenticos_hermes/tasks/vault_ingest.py` (new)
**Cron entry:** `vault-ingest`, schedule `0 * * * *` (hourly on the hour)
**Inputs:** `/opt/vault/skills/`, `/opt/vault/resources/` (recursively)
**Outputs:** Viking `add_resource()` calls, ledger row with counts in `cost_cents=0` (no LLM cost on the ingester side; Viking's own LLM cost is tracked separately by Viking).

Responsibilities:

1. Walk both vault subtrees. For each file, compute a SHA-256 of the bytes. Compare against a small `ingest_state` table in Postgres keyed by `(path, sha)`.
2. For files where the hash differs (or the row is missing), call `viking.add_resource(file_path, scope=...)` with `scope="agent/skills"` if the path is under `/opt/vault/skills/` and `scope="resources/<project>"` otherwise.
3. For files that have been deleted from the vault but are still tracked, call `viking.rm(uri)` and clear the ledger row.
4. Emit one task ledger row per ingester run with summary counts: `{added, updated, removed, skipped, errored}`. Errors are surfaced but do not abort the run — one bad file should not block the others.

**Why a Python task, not a Node job:** the ingester lives in `agenticos-hermes` because it runs *inside* the Hermes container, which already has the Viking Python client and Postgres connection. Putting it in the Node dashboard would require a new container or cross-container DB access for no upside.

### 5.2 Viking LLM configuration (one-time bootstrap)

**Where:** Viking's `config.yaml` on the Droplet, written by an idempotent infra script.
**File:** `infra/scripts/configure-viking-llm.sh` (new)

Content shape:

```yaml
embedding:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: nomic-embed-text         # decision in plan: confirm best Ollama embed model
vlm:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: qwen2.5:7b               # decision in plan: confirm best Ollama VLM
```

This is a one-time setup task with a verification step (post a known doc, confirm Viking generates a non-empty L0 abstract).

### 5.3 Dashboard shell (tabbed)

**Files:**
- Modify: `apps/dashboard/app/layout.tsx` — add shared header
- Modify: `apps/dashboard/app/page.tsx` — turn into tab router (server component)
- Create: `apps/dashboard/components/shell/SharedHeader.tsx`
- Create: `apps/dashboard/components/shell/TabBar.tsx`

The shell is a thin layer. It owns the URL → tab routing (`?tab=live` vs `?tab=memory`, with `live` as default) and renders the shared header above the active tab. Both tabs are full-screen below the header.

**Why URL-driven tabs:** lets the user bookmark either view, lets the Memory tab be the deep-link target from "View in dashboard" buttons in other surfaces, and survives reloads.

### 5.4 Shared header

**File:** `apps/dashboard/components/shell/SharedHeader.tsx`

Three chips, always visible, polling every 30 seconds via TanStack Query:

1. **Cost burn** — today's spend / today's budget, color tier based on remaining budget. Tap → opens cost detail drawer.
2. **Agent health** — green/yellow/red, with the Viking latency (already implemented as `AgentStatusChip` in Spec 1, just relocated into the shared header).
3. **Max quota** — Claude Max remaining quota indicator (Spec 1 has the data shape; v2 just surfaces it).

### 5.5 Live-Ops tab

**Files:**
- Create: `apps/dashboard/app/(tabs)/live/page.tsx`
- Reuse existing components: `LiveRunsStrip`, `RateLimitsPanel`, cost burn-down chart

The Live-Ops tab is mostly an organization pass over what Spec 1 already shipped, plus two new panels:

1. **Live runs feed** — existing `LiveRunsStrip`, promoted to the top of the tab and given more vertical space.
2. **Cost burn-down chart** — existing data, new chart. 24-hour and 30-day toggles.
3. **Agent health panel** — existing `RateLimitsPanel`, slightly enriched with per-agent token usage if available.
4. **Queue depth (new)** — count of `pending` and `running` rows in the tasks ledger per kind; small bar chart.
5. **Recent errors (new)** — last 20 task rows with `status='error'`, error message preview, link to drawer.

### 5.6 Memory tab

**Files:**
- Create: `apps/dashboard/app/(tabs)/memory/page.tsx`
- Create: `apps/dashboard/app/(tabs)/memory/[uri]/page.tsx` — drill-in view
- Create: `apps/dashboard/components/memory/CategoryBrowser.tsx`
- Create: `apps/dashboard/components/memory/AbstractList.tsx`
- Create: `apps/dashboard/components/memory/DetailView.tsx`
- Create: `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx`

The Memory tab is the differentiated piece. Layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Category Browser  │  Abstract List (L0)  │  Detail (L1/L2)   │
│ ─────────────────│ ──────────────────── │ ─────────────────  │
│ user/            │  profile.md          │  # Profile         │
│   memories/      │  └ "User prefers..." │  Overview (L1)...  │
│   ├ profile      │                      │                    │
│   ├ preferences  │  preferences/        │  [Open L2 full]    │
│   ├ entities     │  └ dev-style.md      │                    │
│   └ events       │  └ ui-prefs.md       │  [Trace usage]     │
│ agent/           │                      │                    │
│   memories/      │  entities/           │                    │
│   ├ cases        │  └ farm-zone-A.md    │                    │
│   ├ patterns     │                      │                    │
│   ├ tools        │                      │                    │
│   └ skills       │                      │                    │
│ resources/       │                      │                    │
└──────────────────────────────────────────────────────────────┘
```

Three columns. Left = the Viking namespace tree, scoped to the four user-facing scopes (`resources`, `user`, `agent`, `session`). Middle = L0 abstracts of the items in the selected category. Right = L1 overview by default, with a "Load full L2" button for the original content.

The right-hand panel has a **"Trace usage"** tab that opens the retrieval trajectory graph for the selected URI: when has it been retrieved, by which agent, in which sessions, with what query. The graph node is the URI; edges connect to session nodes; coloring by recency.

### 5.7 Retrieval trajectory graph

**File:** `apps/dashboard/components/memory/RetrievalTrajectoryGraph.tsx`
**Dep:** `react-force-graph-2d` (already in `package.json`)

Pulls from Viking's DebugService observer endpoint (verified API path TBD during planning), normalizes to `{nodes, links}` shape, renders with force-graph-2d. Nodes are sized by retrieval count, colored by type (URI/session/agent).

The viz is read-only and bounded to the last 30 days by default with a date range filter.

### 5.8 Dashboard API routes (new)

The dashboard proxies to the live Viking REST API at `http://openviking:1933`. Every upstream call carries `Authorization: Bearer ${OPENVIKING_API_KEY}`, `X-OpenViking-Account: agenticos`, and `X-OpenViking-User: deploy` (the user can be overridden via env for multi-user deployments later). Endpoint shapes verified against `docs/reference/openviking-v0.3.19-openapi.json`.

| Dashboard route | Verb | Upstream Viking call | Notes |
|---|---|---|---|
| `/api/memory/tree?scope={scope}` | GET | `GET /api/v1/fs/tree?uri=viking://{scope}` | Real upstream uses `uri` not `path`. Param normalization in the route handler. |
| `/api/memory/abstracts?uri={uri}` | GET | `GET /api/v1/fs/ls?uri={uri}` then fan-out `GET /api/v1/content/abstract?uri={child}` for each child | No batch-abstracts endpoint; fan-out happens server-side and is cached. |
| `/api/memory/overview?uri={uri}` | GET | `GET /api/v1/content/overview?uri={uri}` | 1:1 proxy. |
| `/api/memory/detail?uri={uri}&offset=&limit=` | GET | `GET /api/v1/content/read?uri={uri}&offset=&limit=` | Real upstream supports offset/limit chunking; dashboard passes through. |
| `/api/memory/trajectory?uri={uri}` | GET | `GET /api/v1/observer/retrieval` filtered client-side by URI, or `POST /api/v1/relations/build_graph` with body `{root_uri,since}` | Two candidate sources; pick during Phase 5 task 5.1 by inspecting actual responses. |
| `/api/memory/search?q={q}&scope={scope}` | GET | `POST /api/v1/search/find` with JSON body `{query,target_uri}` | Bonus surface — wire from a "Find" affordance in the Memory tab. |
| `/api/memory/stats` | GET | `GET /api/v1/stats/memories` (optionally `?category=`) | Pre-aggregated counts for the CategoryBrowser. |
| `/api/ingest/status` | GET | (none — Postgres `tasks` table) | Last `vault-ingest` run summary. |
| `/api/dashboard/summary` | GET | `GET /api/v1/console/dashboard/summary?timezone=America/New_York` | Bonus: Viking-side aggregated dashboard data. Used by the shared header where it removes a Postgres roundtrip. |

All read-only. No mutations from the dashboard — those happen in Obsidian or by agents.

## 6. Data flow scenarios

**Scenario A: User edits a skill in Obsidian.**
1. User edits `~/AgenticOS-Vault/skills/farm-water-check.md` in Obsidian on Mac.
2. Syncthing replicates to `/opt/vault/skills/farm-water-check.md` on Droplet (typical latency ≤ 30 s).
3. Within an hour, the `vault-ingest` cron job fires. Hash differs from `ingest_state` row. Calls `viking.add_resource("/opt/vault/skills/farm-water-check.md", scope="agent/skills")`.
4. Viking parses, places content under `viking://agent/skills/farm-water-check/`, queues L0/L1 generation. Within a few minutes (depends on Ollama throughput), the abstracts are ready.
5. Next agent invocation that calls `viking.find("water check", target_uri="viking://agent/skills/")` returns the new skill.
6. Dashboard's Memory tab shows the new file under `agent/skills/` when refreshed.

**Scenario B: User asks the Curator to remember a preference during a session.**
1. Agent session writes messages via `session.add_message(...)`.
2. On `session.commit()`, Viking's background memory extraction runs (LLM = local Ollama). It produces an entry under `viking://user/memories/preferences/dev-style.md` (or appends to it).
3. Dashboard's Memory tab shows the new/updated preferences entry on next refresh. The user did *not* edit anything in Obsidian — this is Viking-extracted memory.

**Scenario C: User wants to know "what does the agent think it knows about the farm?".**
1. User opens dashboard → Memory tab → `user/memories/entities/`.
2. Sees a list of L0 abstracts (e.g., "Farm zone A; pasture-managed; rotation cadence 21 days").
3. Clicks one, sees L1 overview.
4. Clicks "Trace usage" → force-graph shows which sessions retrieved this entity in the last 30 days, by which agent.

## 7. Error handling and failure modes

| Failure | Detection | Behavior |
|---------|-----------|----------|
| Ingester can't read a vault file | OSError during walk | Log to task row, mark file as `errored` in `ingest_state`, continue with siblings |
| Viking REST API down | HTTP 5xx or timeout | Task row `status='error'`, surfaced in Live-Ops "Recent errors" panel; next cron tick retries |
| Ollama down | Viking's L0/L1 generation queues stall (Viking's responsibility) | Ingestion succeeds but L0/L1 lag; dashboard Memory tab shows files without abstracts (degraded but legible) |
| Memory tab tries to render a URI Viking returns 404 for | HTTP 404 | Detail panel shows "Item no longer in Viking — may have been moved or removed." Clear UX, no client-side crash |
| Force-graph DebugService endpoint not yet implemented in our Viking version | Compile time / first call | Memory tab still renders, "Trace usage" tab shows "Retrieval trajectories not available with this Viking version" |
| Cost burn header fails to load | TanStack Query error | Chip shows "—" with retry; never blocks the rest of the dashboard |

**Operational principle:** the dashboard is read-only over Viking. Any failure in the read path degrades the affected panel but does not block the dashboard from loading. The Live-Ops tab and Memory tab fail independently.

## 8. Out of scope (deferred to v2.1+)

- **Direct skill editing in the dashboard.** Authoring stays in Obsidian.
- **Multi-agent fleet UI** beyond the one Curator agent. The Live-Ops tab will list whatever agents exist but does not assume more than one.
- **Domain connectors** (smart home / farm sensors / networking / dev) — these are real "manage the farm" features but they belong in their own spec.
- **Public dashboard sharing.** Cloudflare Access is still single-user. No "share view" links in v2.
- **Vault search inside the dashboard.** Use Obsidian for that. Memory tab is for Viking content, not vault content.
- **Mobile-optimized memory tab.** Desktop-first. Live-Ops chips already work on mobile.
- **Local-burst Ollama on Mac** (from the original Medium-priority list) — separate spec.

## 9. Open questions

1. **Best Ollama embedding model and VLM model.** Plan phase needs to benchmark `nomic-embed-text`, `bge-large`, `mxbai-embed-large` for embeddings, and `qwen2.5:7b` vs `qwen2.5:14b` vs `llama3.1:8b` for VLM. Decision criterion: best L0/L1 quality at Ollama latencies the Droplet can sustain on 4 GB RAM.
2. **Viking DebugService observer endpoint shape.** Need to verify exact REST path and JSON shape during Phase 1 of the plan; this affects `RetrievalTrajectoryGraph.tsx`.
3. **`ingest_state` table — own migration or share `tasks` schema?** Lean toward a new `vault_ingest_state` table because it has a different access pattern (keyed by path, not time).
4. **L2 pagination for large files.** Some farm or research docs may be >100 KB. Decide chunk size and whether to render markdown server-side or stream raw.

## 10. Acceptance criteria

The v2 ships when all of the following hold true in production:

1. Hourly `vault-ingest` cron job runs successfully for 7 consecutive days, with a non-zero number of files ingested at least once.
2. Editing a new file in Obsidian results in that file being visible under the Memory tab within ~75 minutes (worst case: edit at minute 1 of the hour, cron at minute 0 of the next hour, plus L0 generation latency).
3. Viking's LLM config is using local Ollama for both embedding and VLM; the dashboard's cost burn-down has not increased over the Spec 1 baseline (no external API spend).
4. Dashboard loads to either tab from a deep link within 1500 ms (P95) under typical home network conditions.
5. Memory tab can browse to any of the four scopes (`resources`, `user`, `agent`, `session`) and drill three levels deep without errors.
6. Trace usage opens the force-graph for at least one memory URI with at least 5 retrieval events.
7. Shared header chips show live data and do not block the rest of the dashboard if any one of them fails.

## 11. Implementation phasing (planning-phase guidance, not commitments)

Seven phases, sequenced so each one is shippable on its own:

1. **Phase 0 — Viking LLM lock-down.** Configure Ollama embeddings + VLM, verify a known-doc roundtrip, document the wizard inputs. ~3 hrs.
2. **Phase 1 — Vault ingester.** New cron job, `ingest_state` table, hash-dedup walker, error path. End-to-end: edit a file in vault, see it in Viking within an hour. ~5 hrs.
3. **Phase 2 — Dashboard shell.** Tab routing, shared header. Both tabs initially placeholder. Cost / health / quota chips wired. ~4 hrs.
4. **Phase 3 — Live-Ops tab polish.** Move existing components in, add queue depth and recent errors panels. ~5 hrs.
5. **Phase 4 — Memory tab.** Three-column browser, L0/L1/L2 progressive disclosure, /api/memory/* routes. ~7 hrs.
6. **Phase 5 — Retrieval trajectories.** Wire Viking DebugService → force-graph, polish the empty/degraded states. ~4 hrs.
7. **Phase 6 — Hardening + acceptance test.** Run the acceptance criteria as automated checks where possible; document where they require manual sign-off. ~3 hrs.

Estimated total: ~31 hours, matching the original "20–30 hours over 2–3 weeks of evenings" target with some buffer.

## 12. Dependencies on other work

- **Spec 1 must remain green.** v2 builds on Spec 1's cost ledger and Viking client. The cron-job permission saga (see Spec 1 §11 acceptance results) must be fully resolved before v2 Phase 1 lands.
- **`@honcho-ai/sdk` removal** (PR #93) must merge before v2 starts; this is in flight.
- **Hermes overlay image** (Spec 1 PR #84) is unchanged.

## 13. Non-goals — what this spec is explicitly not

- It is **not** a redesign of the agent runtime. Hermes + Viking + Ollama stay.
- It is **not** a new memory layer. Viking is the memory layer, period.
- It is **not** a vault editor. Obsidian is the vault editor.
- It is **not** a public-facing app. Cloudflare Access remains a hard gate.

---

**End of design.**
