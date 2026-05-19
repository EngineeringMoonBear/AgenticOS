# Phase 3 — v0.14.0 Implications (Supplement)

**Status**: Proposed (2026-05-19)
**Supplements**: `docs/phase-3-hermes-integration.md`
**Does not supersede**: the original 11 decisions stand unless explicitly noted below.

Hermes Agent v0.14.0 ("Foundation Release") shipped 2026-05-18 with several new capabilities that **change three Phase 3 contracts before implementation begins**: the RunCard schema (handoff), the run objective model (subgoal), and the rate-limit observability fields (cache hits). Plus one open verification: whether `hermes proxy` works with an Anthropic Claude subscription.

This doc is the additive specification for those four items. The originating source is `vault/sources/2026-05-19-hermes-foundation-update-v0.14.0.md` (synthesized from a 11:32 walkthrough; treat technical claims as "to verify against the actual changelog before implementation").

For the scheduler-overlap question, see `docs/adr/0003-scheduler-ownership.md` (decision #2 affirmed).

---

## 1. RunCard schema extension — handoff history

### What v0.14.0 changes

Hermes `/handoff` transfers a live session across models, personas, or profiles without dropping context. Preserved across the handoff: messages, tool calls, memory, active workflows, session state.

The Phase 3 RunCard schema assumes 1 run ↔ 1 model:

```ts
// Current (Phase 3 spec § 5.2)
interface Run {
  id: string;
  skill: string;
  status: RunStatus;
  model: string;          // ← one model per run
  cost_usd: number;       // ← one cost figure per run
  tools_used: string[];
  started_at: string;
  ended_at?: string;
  lane: "hermes" | "sandcastle";
  tags: string[];
}
```

A handed-off run is one logical task spanning multiple models. Rendering it as "model: claude-opus" loses the fact that the first 4 minutes ran on Sonnet, then handed off to Opus for the final synthesis.

### Proposed schema

Replace `model` and `cost_usd` (single-valued) with a `legs` array. Add `current_leg_index` for fast "what's running right now" rendering.

```ts
interface RunLeg {
  index: number;                   // 0-based; current leg = run.legs[run.current_leg_index]
  model: string;                   // e.g. "claude-sonnet-4-6"
  started_at: string;              // ISO 8601
  ended_at?: string;               // unset while this leg is the current one
  reason: "initial" | "handoff" | "subgoal_continuation";
  cost_usd: number;                // attributed to this leg
  cache_hits?: CacheMetrics;       // see § 3 below
  tools_used: string[];            // tools called during this leg
  handoff_from?: number;           // previous leg index this one took over from
}

interface Run {
  id: string;
  skill: string;
  status: RunStatus;
  lane: "hermes" | "sandcastle";
  tags: string[];
  started_at: string;
  ended_at?: string;
  legs: RunLeg[];                  // length >= 1; first leg is the originating model
  current_leg_index: number;       // legs.length - 1 while running
  total_cost_usd: number;          // sum of legs[*].cost_usd; precomputed for the feed view
}
```

### Migration

Phase 3 hasn't shipped — no live data to migrate. The schema lands as `legs`-first from day one. Fixtures in Phase 2's RunCard preview should be updated in the same PR that lands the new schema.

### UI impact

The `RunCard` summary view continues to show the **current** leg's model + accumulated `total_cost_usd`. A new "Handoff history" expandable section in the run drawer renders the legs as a timeline:

```
🤖 claude-sonnet-4-6   →  🧠 claude-opus-4-7   →  🤖 claude-sonnet-4-6
0:00 – 4:12 ($0.08)        4:12 – 7:30 ($0.41)   7:30 – running ($0.05)
                           reason: handoff       reason: handoff
                           tools: web_search,    tools: write_file
                                  read_files
```

When `legs.length === 1` (no handoff occurred), the drawer hides the handoff history section entirely — the schema supports both cases without visual clutter for the simple case.

### Open questions

- [ ] Does Hermes `/handoff` emit a discrete event over SSE (e.g. `event: handoff`) that AgenticOS can append a new leg on, or does it just appear as a model change in the running event stream? Verify in the v0.14.0 changelog or by snooping the SSE channel against a test run.
- [ ] Persona/profile handoffs (without model change) — do they get a leg too? Recommended yes (so the timeline shows persona shifts), but verify the underlying event signal exists.

---

## 2. Run-objective extension — subgoal stack

### What v0.14.0 changes

Hermes `/subgoal` dynamically appends objectives to a long-running autonomous workflow. The run accumulates new goals mid-execution without restart.

The Phase 3 spec doesn't currently model a structured "objective" field on `Run` — the closest thing is the skill name and the initial prompt. A run that gains 3 subgoals mid-flight has no good place to surface them.

### Proposed schema

Add an append-only `objectives` array to `Run`. Index 0 is the originating skill objective; later indices are subgoals.

```ts
interface RunObjective {
  index: number;                   // 0 = initial; 1+ = subgoals
  text: string;                    // the objective statement
  appended_at: string;             // ISO 8601
  appended_by: "skill" | "user" | "agent_self";
  // appended_by="agent_self" = the agent called /subgoal on its own
  // appended_by="user" = surfaced via AgenticOS UI (out of scope for Phase 3)
  // appended_by="skill" = the originating skill definition supplied this
  status?: "active" | "completed" | "abandoned";
  completed_at?: string;
}

interface Run {
  // ... existing fields ...
  objectives: RunObjective[];      // length >= 1
}
```

### UI impact

The RunCard summary shows the **current** objective text (the highest-indexed `active` objective). The drawer adds an "Objectives" section above the existing log/tool views, rendering the stack:

```
Objectives (3)
  ✓ 0:00 Process today's inbox items
  ✓ 4:12 [subgoal] Verify wiki link integrity before promoting
  ● 7:30 [subgoal] Triage the 3 candidates flagged as duplicates
```

Active objective gets a filled dot; completed gets a checkmark; abandoned gets a dash.

### Curator coupling

The Curator skill (Wave 4) is the first concrete case where subgoals matter. Likely Curator flow:

1. Initial objective: "Process inbox items >7 days old."
2. After classification, `/subgoal` → "Promote items with confidence ≥ 0.7."
3. After promotion attempts, `/subgoal` → "Lint wiki for new broken links from promoted pages."

Surface this in the Curator's nightly log (`vault/wiki/_meta/curator-log.md`) by writing one line per objective transition, sourced from the `objectives[]` history.

### Open questions

- [ ] Does Hermes `/subgoal` emit a discrete SSE event AgenticOS can listen for, or is it inferred from agent messages?
- [ ] Should `appended_by="user"` (manual user-driven subgoals via the AgenticOS UI) ship in Phase 3 or defer to Phase 6? **Recommendation: defer.** Phase 3 captures and displays subgoals only.

---

## 3. Rate-limit observability extension — cache metrics

### What v0.14.0 changes

Hermes v0.14.0 added cross-session 1-hour prompt caching for Claude workflows. First responses across sessions become faster and cheaper.

The Phase 3 spec captures 6 Anthropic limit dimensions from response headers (§ Decision #11). Cache hits are a related signal Anthropic exposes through the API: `cache_creation_input_tokens`, `cache_read_input_tokens`, and the implicit "tokens billed at 0.1× rate."

Without surfacing cache hits, the Curator budget cap ($1.00/run) becomes harder to reason about — a cache-heavy run that costs $0.15 looks identical to a cold run that costs $0.95 until the cost number is computed.

### Proposed addition

Add `CacheMetrics` to each `RunLeg` (see § 1 above) and a new compact view to the `RateLimitsPanel`.

```ts
interface CacheMetrics {
  cache_creation_input_tokens: number;   // tokens written into cache
  cache_read_input_tokens: number;       // tokens served from cache (10x cheaper)
  uncached_input_tokens: number;         // tokens billed normally
  cache_hit_ratio: number;               // cache_read / (cache_read + uncached)
}
```

`cache_hit_ratio` is precomputed for the feed view (avoids per-render math).

### RateLimitsPanel addition

The panel's expanded view (§ Phase 3 spec § 7.3) currently shows a 24h SVG sparkline per dimension. Add a new tab "Cache" alongside the existing dimensions, rendering:

- 24h hit-ratio sparkline (rolling average)
- Today's cache-served-tokens total (the cost savings explicit: "Saved ~$0.42 today via cache hits")
- Per-skill breakdown (Curator: 87% hit ratio; ad-hoc runs: 22%)

The projection view ("Will the next run fit?") becomes more accurate when it can subtract cached-token cost from the projection.

### Logging

`~/.agenticos/rate-limits.jsonl` (rolling 30-day, append-only) gains the cache fields per request entry. No new file; existing rotation logic applies.

### Open questions

- [ ] Does the `hermes proxy` (which fronts the Claude subscription — see § 4) expose Anthropic's response headers and cache fields cleanly, or does it strip them? If stripped, this entire metric collection breaks for proxied requests. **High priority** for the v0.14.0 verification work.

---

## 4. `hermes proxy` + Anthropic Claude — verification test plan

### Why this matters

If `hermes proxy` works with an Anthropic Claude subscription specifically, AgenticOS can dispatch Hermes runs against the user's existing Claude subscription instead of via API key, materially changing the cost model — particularly for the Curator's $1.00/run budget cap.

The v0.14.0 walkthrough names Claude as a supported provider but only demonstrates Codex. So the question is open.

### Test plan (to run once Hermes is installed locally — Phase 3 Pre-T1)

```
# 1. Install Hermes via the new PyPI package
pip install hermes  # or whatever the canonical install command turns out to be
hermes setup       # walk the config wizard, log into Claude subscription

# 2. Start the proxy
hermes proxy &     # default port unknown; capture from output

# 3. Test a basic completion against the proxy as if it were OpenAI.
# The Authorization header is required by OpenAI-compatible clients but is
# NOT validated by the Hermes proxy — any placeholder string works.
# gitleaks:allow
curl http://localhost:PROXY_PORT/v1/chat/completions \
  -H 'Authorization: Bearer <placeholder-not-validated>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role":"user","content":"ping"}],
    "max_tokens": 16
  }'

# 4. Inspect headers for Anthropic-specific fields needed by RateLimitsPanel
curl -v http://localhost:PROXY_PORT/v1/chat/completions ...
# Look for: anthropic-ratelimit-* headers; cache_creation_input_tokens
#          / cache_read_input_tokens in the response body
```

### Pass criteria

1. ✅ HTTP 200 with a model response
2. ✅ Response includes Anthropic rate-limit headers (or equivalent fields in proxy-translated form)
3. ✅ Response includes cache token counts when applicable
4. ✅ Cost attribution from the subscription is observable (e.g. via `hermes` itself or via Anthropic console)
5. ✅ The proxy survives a 5-minute idle period without dropping the subscription session

### If any fail

- Fail (1): proxy + Claude isn't supported; stick with API key for AgenticOS dispatch
- Fail (2): rate-limit observability needs a different capture path (e.g. read from Hermes's own telemetry, not response headers). Defer the panel work or pivot the data source.
- Fail (3): cache metrics break for proxied requests (§ 3 open question above). Decide whether to skip cache panel for proxy users or add a non-proxy capture path.
- Fail (5): proxy isn't durable enough for nightly Curator; stick with API key for the daemon use case even if proxy works for ad-hoc.

### Document the result

Update this section with PASS/FAIL per criterion and the actual proxy port + observed headers. Reference from:
- `docs/phase-3-hermes-integration.md` (link inline if proxy is chosen as dispatch path)
- `vault/wiki/Software/AgenticOS.md` open-questions section

---

## Cross-references

- `docs/phase-3-hermes-integration.md` — the original signed Phase 3 spec
- `docs/adr/0003-scheduler-ownership.md` — scheduler decision affirmed with v0.14.0 context
- `vault/sources/2026-05-19-hermes-foundation-update-v0.14.0.md` — originating source
- `vault/wiki/Software/AgenticOS.md` — vault entry tracking implications + open questions
- `vault/wiki/_shared/Media Fetching.md` — how this source was captured (for reproducibility on future releases)
