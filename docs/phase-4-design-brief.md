# Phase 4 — Sandcastle Dispatch: Design Brief

> **⚠️ STALE (predates 2026-05-20 foundation v2 pivot):** This brief was written when Phase 3 targeted Hermes Agent as runtime and Sandcastle was scoped as the next major build. The foundation v2 spec ([`superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md`](superpowers/specs/2026-05-20-agenticos-foundation-v2-design.md)) defers multi-agent and Sandcastle-like parallel-coding-agent work to v2+. **Don't treat this brief as current scope.** When v1 ships and v2 brainstorming begins, this brief gets revisited: most concepts (ephemeral worktrees, parallel coding agents, hand-back-for-review pattern) carry forward; the Hermes/MCP integration assumptions need rewriting against Claude Code + Honcho.

**Status**: Brainstorming questionnaire (2026-05-18) — stale; review against foundation v2 before re-scoping
**Owner**: AgenticOS — single-developer (Josh)
**Predecessors required**: Foundation v2 v1 (Curator + dashboard observability) must be merged before Phase 4 begins.

---

## Context: The Hermes / Sandcastle execution-plane split

Phase 3's architecture checkpoint established a two-plane model:

```
AgenticOS (Next.js, port 3000)
  │
  ├─ Hermes plane (127.0.0.1:7600)
  │    Persistent daemon, tool-loop agent, vault-bound via MCP-to-AgenticOS
  │    Curator skill: long-horizon, vault R/W, no code execution
  │
  └─ Sandcastle plane (NEW — Phase 4)
       Claude Code subagents, git worktrees, per-project-root Dockerfile
       Code tasks: read + write repo files, run tests, open PRs
       Vault access: re-uses MCP-to-vault binding from Phase 3 (same pattern)
```

Hermes = "brain that reads and writes knowledge." Sandcastle = "hands that write and run code." Neither plane knows about the other at runtime; AgenticOS is the only orchestrator. Phase 4 adds the Sandcastle plane without touching the Hermes HTTP interface.

The skill abstraction commitment from Phase 3 is: two concrete examples (Curator in Phase 3 + first Sandcastle skill in Phase 4) → unified `Skill` type lands in Phase 4. That abstraction is a deliverable of T1 + T2.

---

## Proposed Architecture Shapes

**Approach A — Thin orchestrator, fat agent** (recommended below):
`sandcastle-orchestrator` is a lightweight TypeScript package that builds the worktree, writes `CLAUDE.md` context, and shells out to `claude` CLI (or wraps the Claude Code SDK). Each agent run is an OS process. AgenticOS tracks it via a run record + SSE. No long-lived Sandcastle daemon — processes are ephemeral. Parallelism = N simultaneous child processes.

**Approach B — Hermes-backed Sandcastle**:
Sandcastle agents are Hermes runs with a special `sandcastle` tool injected. Re-uses the Hermes daemon and its SSE/event infrastructure. Simpler event model, but conflates two planes, makes the IA's lane distinction blurry, and couples Sandcastle lifecycle to Hermes uptime.

**Approach C — External daemon (Daytona/Modal)**:
Sandcastle runs in a remote execution environment. Higher isolation, but adds network dependency, auth complexity, and diverges from the IA spec's "Claude Code" agent provider default.

> **RECOMMENDED**: Approach A. It matches the IA spec's Sandcastle Defaults section (`Agent provider: Claude Code`, `Worktree base dir: ~/Dev Projects/.worktrees/`), keeps the plane split clean, and avoids adding a second daemon. The orchestrator package mirrors the `@agenticos/vault-core` / `@agenticos/hermes-client` workspace package pattern from Phases 2–3.

---

## Design Questions

---

### Q1. Skill abstraction shape — what is the unified `Skill` type?

Now that we have two examples — Curator (Hermes, vault-bound, scheduled) and the first Sandcastle skill (code task, project-root-bound, dispatch-on-demand) — what shape covers both?

**Option A** — Single flat type, `lane` discriminates behavior:
```ts
interface Skill {
  id: string; slug: string; title: string; description: string;
  icon: string; tags: string[];
  lane: 'hermes' | 'sandcastle';
  projectRoots?: string[];        // undefined = global (Curator pattern)
  cron?: string;                  // undefined = on-demand only
  modelTier: 'haiku' | 'sonnet' | 'opus';
  budgetCapUsd?: number;
  promptPath: string;             // path to system prompt file
  parameters?: SkillParameter[];
}
```

**Option B** — Discriminated union, each lane extends a base:
```ts
type Skill = HermesSkill | SandcastleSkill;
interface BaseSkill { id, slug, title, tags, icon, modelTier, budgetCapUsd, promptPath, parameters }
interface HermesSkill extends BaseSkill { lane: 'hermes'; cron?: string }
interface SandcastleSkill extends BaseSkill { lane: 'sandcastle'; projectRoots: string[]; branchStrategy: BranchStrategy; dockerfilePath?: string }
```

**Option C** — Registry-file-first (skill as markdown frontmatter, no TS type until loaded):
Skills live as `.md` files in `~/.claude/skills/`; a loader parses frontmatter at runtime into a loose record. Type safety comes from Zod at load time, not from a TS union.

**Option D** — Option B union + Option C file format (belt and suspenders):
Discriminated union in TS; markdown frontmatter on disk; Zod schema converts disk → union at load time.

> **RECOMMENDED**: Option D. The discriminated union keeps Sandcastle fields (`projectRoots`, `branchStrategy`, `dockerfilePath`) required — not optional — so TypeScript enforces them at dispatch. The markdown-frontmatter-on-disk format matches what the IA spec's New Skill Creation flow writes (`~/.claude/skills/[slug].md`). Zod is already the schema layer across the project (see `apps/dashboard/lib/config/schema.ts`).

---

### Q2. Sandcastle agent provider — Claude Code only, or also Codex / opencode / pi?

**Option A** — Claude Code only (lock to `claude` CLI / Claude Code SDK):
Simplest. Matches IA spec `Sandcastle Defaults → Agent provider: Claude Code`. One provider, one subprocess shape, one event format.

**Option B** — Abstract provider interface; Claude Code is default:
Define `AgentProvider` interface; `ClaudeCodeProvider` ships in Phase 4; others pluggable later. ~20% overhead for the abstraction layer.

**Option C** — Claude Code + Codex as co-equal providers in Phase 4:
Adds OpenAI key management, a second event-parsing path, and split test surface. High overhead.

> **RECOMMENDED**: Option A in Phase 4. The IA spec is explicit. Add the `AgentProvider` abstraction in Phase 5 or later if demand arises. Don't abstract prematurely — Curator is the lesson here (Phase 3 committed to hardcoded TypeScript for exactly this reason).

---

### Q3. Branch strategy default per project root

Each project root can have a default branch strategy. Three candidates:

**Option A — `branch-per-task`** (create a new branch per dispatch):
Each agent gets `sandcastle/<run-id>` or `sandcastle/<slug>-<short-hash>`. Clean history; easy to discard; natural fit for PR-based review flow. Slightly more git overhead.

**Option B — `merge-to-head`** (agent works on a copy of HEAD, merges back at completion):
Lower branch clutter. Risky if run fails mid-merge. Harder to inspect mid-run state.

**Option C — `head`** (agent works directly on current HEAD, no branching):
Dangerous for multi-run or parallel scenarios. Appropriate only for fast mechanical tasks (rename, format) where rollback is trivial. Should be opt-in per skill, not the default.

> **RECOMMENDED**: `branch-per-task` as the project-root default (matches IA spec `Default branch strategy: branch`). Expose `head` and `merge-to-head` as per-skill overrides via skill frontmatter. The Skill Detail Drawer (IA § 2) already shows "Branch strategy" in the Execution Config section — Phase 4 makes this field live.

---

### Q4. Worktree location — repo-internal or external?

Git worktrees can live inside the repo directory (`.sandcastle/worktrees/<run-id>`) or outside (`~/Library/Caches/agenticos/worktrees/<run-id>`).

**Option A — External, under a configurable base dir** (`~/Dev Projects/.worktrees/` per IA spec settings default):
- No pollution of the repo's working tree
- Works cleanly with `.gitignore` (nothing to ignore)
- Easy to enumerate all live worktrees across all project roots from one location
- Path is configurable in Settings → Sandcastle Defaults

**Option B — Repo-internal** (`.sandcastle/worktrees/<run-id>`):
- Self-contained per repo
- Adds `.sandcastle/worktrees/` to every `.gitignore`
- Can cause confusion with Dockerfile sibling (T1 installs `.sandcastle/Dockerfile`)

**Option C — System temp** (`/tmp/agenticos/worktrees/<run-id>`):
- Evicted on reboot; no persistence for debugging
- Stale worktrees vanish silently

> **RECOMMENDED**: Option A — external base dir, defaulting to `~/Dev Projects/.worktrees/`, configurable per IA spec. T1 installs `.sandcastle/Dockerfile` repo-internally (that's appropriate since it's version-controlled). Worktrees are ephemeral run artifacts, not committed code — they belong outside the repo tree.

---

### Q5. Parallel concurrency cap — max simultaneous Sandcastle agents?

**Option A — 3 concurrent agents**:
Conservative. Safe for a laptop (each Claude Code agent = one OS process + a git worktree checkout). Leaves headroom for Hermes daemon and Next.js dev server.

**Option B — 5 concurrent agents**:
Moderate. Fits T3's "parallel dispatch" requirement comfortably. Still manageable CPU/disk-IO-wise on an M-series Mac with SSD.

**Option C — 8 concurrent agents**:
Aggressive. Rate-limit risk is high (8 simultaneous Sonnet streams hit the TPM ceiling fast). The Phase 3 rate-limit projection panel would frequently warn. Requires careful cost guardrail integration to be safe.

**Option D — Configurable cap per project root (no global default)**:
Flexible but adds settings surface complexity. Most users set it once globally.

> **RECOMMENDED**: Option B — default cap of 5, configurable globally in Settings → Sandcastle Defaults, overridable per project root. 5 balances T3's parallel dispatch use case with realistic rate-limit and resource constraints. The Phase 3 rate-limit projection logic adapts by multiplying the single-run token estimate by the concurrency cap when projecting whether the next batch will fit (see Q12).

---

### Q6. Cost guardrails — per-dispatch and per-day

**Option A — Per-dispatch budget cap only** (inherit IA spec's warn-at-$0.50 / block behavior):
Each Sandcastle skill declares `budgetCapUsd` in frontmatter. Dispatch drawer shows estimate. Block if over daily cap.

**Option B — Per-dispatch + per-parallel-batch cap**:
Parallel dispatch (T3) can multiply cost N× vs. single dispatch. Add a "batch cap" = `budgetCapUsd × concurrency`. Warn if estimated batch total exceeds batch cap. Separate field in Settings.

**Option C — Per-dispatch + per-day + per-project-root daily cap**:
Most granular. Three cap dimensions. High settings surface overhead.

> **RECOMMENDED**: Option B. Parallel Sandcastle runs are the new cost multiplier Phase 2's Observability didn't account for (Curator is always single-run). A batch cap = `budgetCapUsd × min(batchSize, concurrencyCap)` is computable at dispatch time with no new UI surface (just another threshold in the existing dispatch warn flow from IA § 7). Per-project-root caps (Option C) can be added in Phase 5 polish if needed.

---

### Q7. Failure handling — retry strategy for stale or stuck agents

**Option A — No auto-retry; manual "Retry" from run card**:
Matches Phase 3's staleness model — surface stale state in UI, user decides. Sandcastle adds a "Stale" badge when no stdout for >10 min (longer threshold than Hermes's 30 min, because code tasks legitimately run longer).

**Option B — One auto-retry after configurable stale timeout**:
Orchestrator cancels the stuck process, deletes the worktree, creates a fresh worktree, relaunches the agent. Logged as a retry event in the run record. Max 1 auto-retry before surfacing to user.

**Option C — Exponential backoff with up to 3 retries**:
Standard distributed-systems pattern. Overkill for a single-user local orchestrator where the user can manually intervene in seconds.

> **RECOMMENDED**: Option A for Phase 4. The staleness UI from Phase 3 (`cancel-and-restart` action in the kebab menu) already gives the user the manual path. Sandcastle stale threshold: 10 minutes without stdout (vs. Hermes's 5-minute threshold per Phase 3 checkpoint). Auto-retry adds complexity and risk of duplicate worktrees if the cleanup step fails. Revisit in Phase 6.

---

### Q8. Output integration — auto-PR or local commits only?

**Option A — Local commits only** (agent commits to its branch, leaves it):
Simplest. User can `git push` and open a PR manually, or use `gh pr create` from the terminal. No `gh` CLI dependency in the orchestrator.

**Option B — Auto-PR via `gh` CLI** (orchestrator runs `gh pr create` after agent exits 0):
Reduces friction significantly. PR title from skill title + run ID. PR body from agent's final summary (last stdout block). Requires `gh` CLI installed and authenticated. PR URL surfaced in run record + toast.

**Option C — Auto-PR with approval gate** (orchestrator creates draft PR; user promotes to ready-for-review in the Sandbox tab of the Run Detail Drawer):
Best of both: automation with a human checkpoint. Adds a "Promote draft PR" button to the Sandbox tab.

> **RECOMMENDED**: Option C. Draft PR creation fires automatically on agent exit 0 with `gh pr create --draft`. The Sandbox tab (already spec'd in IA § 4 Run Detail Drawer) gets one new button: "Promote to review-ready." Agents that exit non-zero get a "Retry" action instead. This matches the overall AgenticOS "suggest → review → commit" pattern established in Phase 2's Inbox promote flow and hardened in Phase 3's Curator.

---

### Q9. Auto-tag inference — project root config alone, or also LLM classifier?

Run cards auto-tag by lane and project root (T5). The question is whether tag inference goes further.

**Option A — Project root tags only**:
Each `ProjectRoot` in `schema.ts` already has a `tags: string[]` field. Apply those tags to every run dispatched against that root. Fast, zero LLM cost, deterministic.

**Option B — Project root tags + prompt content (LLM classifier, Haiku)**:
Extract additional domain tags by passing the dispatch prompt to a fast Haiku classifier. Adds ~$0.001 per dispatch. More precise tagging for cross-domain skills.

**Option C — Project root tags + skill frontmatter tags**:
Skills already carry a `tags` array in frontmatter (IA § 2 Skill Card Anatomy). Union of root tags and skill tags covers most cases without an LLM call.

> **RECOMMENDED**: Option C for Phase 4. Union of `ProjectRoot.tags` + `Skill.tags` is free, deterministic, and already covers the IA spec's filter requirements. Option B (LLM classifier) is a Phase 5 enhancement — defer until the tag taxonomy is stable enough to train a consistent classifier against.

---

### Q10. "New run" palette UX — skill picker only, or also ad-hoc prompts?

T6 spec: dispatch flow in the command palette.

**Option A — Skill picker only**:
⌘K → Run section → pick registered skill → dispatch confirm drawer. Matches existing IA spec § 5 `New Run / Dispatch Flow from Anywhere`. Simple, consistent.

**Option B — Skill picker + ad-hoc prompt input**:
⌘K → type a natural-language task → if no skill match, show "Run as ad-hoc Sandcastle task" option → dispatch with auto-selected project root + Sonnet tier. Ad-hoc runs are not saved as skills.

**Option C — Ad-hoc only** (skill picker deferred to later):
Inconsistent with Phase 3's Curator skill model. Eliminates skill reuse. Not recommended.

> **RECOMMENDED**: Option B. The IA spec's command palette already includes "New Skill" and lists all skills under the Run section. Phase 4 adds "Run as ad-hoc" as a fallback path when no registered skill matches the query. Ad-hoc runs are tagged `#ad-hoc` automatically, logged in the run feed, and expose a "Save as skill" action in the Run Detail Drawer footer (alongside the existing Retry / Fork / Archive actions). This mirrors how Obsidian captures fleeting notes — quick entry now, formalize later.

---

### Q11. Sandcastle vault access — MCP-to-vault or direct `/api/vault`?

Hermes (Phase 3) reads/writes vault via the MCP server at `127.0.0.1:7610` (11 tools exposed as MCP endpoints). Sandcastle agents are TypeScript-native Claude Code subagents — they could call `/api/vault` directly via HTTP instead.

**Option A — Same MCP-to-vault binding as Hermes**:
Sandcastle agents get the same 11-tool MCP surface. No new API surface. Auth model is identical (loopback + same OS user). Vault access policy is enforced in one place (the MCP server).

**Option B — Direct `/api/vault` HTTP calls** (Sandcastle is TS-native, can import `@agenticos/vault-core` or call the Next.js API routes):
Bypasses MCP indirection. Faster for read-heavy tasks. But adds a second vault access path that must be separately hardened.

**Option C — No vault access for Sandcastle** (code agents should not touch the knowledge base):
Cleanest separation. But blocks use cases like "agent writes a wiki page summarizing the PR it just opened" — a legitimate cross-plane flow.

> **RECOMMENDED**: Option A — reuse the Phase 3 MCP-to-vault binding. The orchestrator injects `--mcp-server http://127.0.0.1:7610` when launching the Claude Code subprocess. This is zero new code: the MCP server already exists after Phase 3. Tool access policy can be restricted per-skill (e.g., Sandcastle skills get read-only vault tools by default; write tools require an explicit skill-frontmatter opt-in). The "single access path" principle prevents the vault from having two enforcement surfaces to maintain.

---

### Q12. Cost dashboard impact — how does the Phase 3 rate-limit projection adapt for parallel Sandcastle batches?

Phase 3 added a "will the next run fit in budget?" projection to the Observability sidebar. Sandcastle parallel batches multiply token consumption.

**Option A — Projection per individual run** (no change to Phase 3 logic):
Each run estimates independently. Batch of 5 looks like 5 separate upcoming runs. User mentally multiplies. Fragile UX.

**Option B — Batch-aware projection** (T3 dispatch provides N to the projection engine):
`/api/limits` projection endpoint accepts an optional `?batchSize=N` param. The UI passes N at dispatch time. Projection returns "💚 batch of 3 fits" or "⚠️ batch of 5 risks throttle — suggest 3." No new data collection needed; just arithmetic over existing `rate-limits.jsonl`.

**Option C — Separate Sandcastle cost lane in Metrics dashboard**:
Run feed already distinguishes by lane (🔄 Hermes vs 🏖️ Sandcastle per IA § 4). The Metrics subview's group-by selector already includes `lane`. No new aggregation logic needed — just ensure Sandcastle runs are tagged with `lane: sandcastle` in the run record (T5 auto-tag handles this).

> **RECOMMENDED**: Option B + Option C as a pair. Option C is nearly free (T5 already emits lane tags; the Metrics breakdown-by-lane selector exists). Option B requires a small patch to the Phase 3 projection endpoint — worth doing in T3 since the dispatch endpoint is the natural place to pass `batchSize`.

---

## Proposed Sequencing

The 6 Asana tasks map to 4 waves. T1 and T2 are foundations; T3–T6 can parallelize more aggressively than Hermes because Sandcastle has no daemon to stand up first.

```
                                                            wave    agent tier
T1  Install Sandcastle + .sandcastle/Dockerfile per root    1      Haiku (file scaffolding)
T2  sandcastle-orchestrator package                         1      Sonnet (TS package, test-heavy)
             ↓ (T2 must complete before T3 and T4)
T3  /api/sandcastle/dispatch (single + parallel)            2      Sonnet
T4  Sandcastle run cards + drawer Sandbox tab               2      Haiku (UI wiring; Phase 3 RunCard is the template)
             ↓ (T3 must complete before T5 and T6)
T5  Auto-tag runs by project root + lane                    3      Haiku (mechanical tag injection)
T6  "New run" dispatch flow in command palette              3      Sonnet (UX: ad-hoc mode, skill picker)
```

T1 and T2 run in parallel (disjoint: T1 is config/Dockerfile scaffolding per project root; T2 is the orchestrator TS package). T3 + T4 run in parallel after T2. T5 + T6 run in parallel after T3.

**Estimated wall-clock**: 4 waves × 1–2 sessions each ≈ **4–6 sessions**. T2 (orchestrator) and T6 (palette UX) are the long poles.

**Test target**: Phase 3 closes at ~190 tests. Phase 4 adds:

| Layer | Tests | Notes |
|---|---|---|
| `packages/sandcastle-orchestrator/` | ~25 | Worktree lifecycle, process spawn/kill, branch strategy, stale detection |
| `/api/sandcastle/dispatch` route | ~10 | Single + parallel, budget cap enforcement, batch-size projection |
| Run card / Sandbox tab (component) | ~6 | Drawer renders Sandbox tab for `lane: sandcastle` runs |
| Auto-tag logic | ~5 | Union of root tags + skill tags; lane tag injection |
| Palette dispatch flow | ~5 | Ad-hoc path, skill picker, "Save as skill" action |
| E2E (Playwright) | 2 | Single dispatch → run card live → Sandbox tab; parallel dispatch → 3 run cards |

**Phase 4 target**: ~190 + ~53 ≈ **~243 tests**.

---

## Risks + Unknowns

1. **`gh` CLI availability**: Option C (auto-draft PR) requires `gh` auth. If not configured, the orchestrator must degrade gracefully to local-commits-only and surface a settings warning. T8 (output integration) should detect `gh auth status` at dispatch time, not at install time.

2. **Worktree cleanup on failure**: If the Claude Code subprocess crashes mid-task, the worktree may be left in a dirty state. The orchestrator must register a cleanup handler (process `exit` + `SIGTERM` + `SIGINT`) to `git worktree remove --force <path>`. Untested edge: what happens if the host machine reboots with an active worktree? Answer: the orchestrator re-scans `~/.worktrees/` on startup and marks any orphaned worktrees as `stale` in the run record.

3. **Rate-limit collision with Hermes**: If Hermes Curator runs at 03:00 and a Sandcastle batch of 5 fires at 03:05, both lanes compete for the same TPM ceiling. The Phase 3 projection logic is per-run, not cross-lane. Phase 4 should pass the currently-running Hermes run's estimated remaining tokens into the batch projection. The `/api/limits` endpoint has the data; wiring it into dispatch is a one-session task, but it's easy to forget.

4. **Skill abstraction migration cost**: Phase 3 ships `lib/skills/curator.ts` as hardcoded TypeScript (by design). Phase 4 must extract it into the unified `Skill` type (Q1 above) and load it from disk frontmatter via the Zod loader. This is the one migration step that touches Phase 3 code. Scope it as the first PR in T2, before any new Sandcastle skills are written.

5. **ProjectRoot `tags` sparsity**: The current `ProjectRootSchema` in `schema.ts` has `tags: z.array(z.string())` with no minimum length. If a user registers a project root with zero tags, Sandcastle runs against that root will be untagged (except for `lane: sandcastle`). The dispatch confirm drawer should warn when tagging would be empty and prompt the user to add at least one tag to the project root.

---

## References

- Phase 2 design: `docs/phase-2-design.md` — `@agenticos/vault-core` package pattern; Zod-as-schema-layer; atomic write discipline; "suggest → review → commit" UX template
- Phase 3 brainstorming checkpoint: `docs/phase-3-brainstorming-checkpoint.md` — Hermes/Sandcastle plane split diagram; MCP-to-vault binding; rate-limit observability architecture; skill-abstraction deferral rationale
- Information Architecture: `docs/information-architecture.md` — § 4 (Observability, RunCard anatomy, Sandbox tab, Sandcastle lane indicator); § 6 (Settings → Sandcastle Defaults, Project Roots table); § 2 (Skill Card, Skill Detail Drawer, New Skill Creation flow)
- Config schema: `apps/dashboard/lib/config/schema.ts` — `ProjectRootSchema` (`path`, `tags`), `ConnectorConfigSchema`, `AgenticOSConfigSchema`
- IA spec Sandcastle Defaults: `Agent provider: Claude Code`, `Default branch strategy: branch`, `Worktree base dir: ~/Dev Projects/.worktrees/`
- Asana tasks: GIDs 1214851415556802 (T1), 1214851299476813 (T2), 1214851403802438 (T3), 1214851151829996 (T4), 1214851403854798 (T5), 1214851272695524 (T6)
- Claude Code SDK: <https://docs.anthropic.com/en/docs/claude-code/sdk>
- gh CLI docs: <https://cli.github.com/manual/gh_pr_create>
