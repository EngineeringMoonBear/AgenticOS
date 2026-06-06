# Sandcastle Spike

Throwaway evaluation of `mattpocock/sandcastle` — published on npm as
**`@ai-hero/sandcastle`**. See the spec:
`docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md` and the plan:
`docs/superpowers/plans/2026-06-06-sandcastle-spike.md`.

> ⚠️ **Package-name gotcha:** the bare npm name `sandcastle` is an *unrelated*
> "sandbox for untrusted JavaScript" library. The Matt Pocock coding-agent
> orchestrator is **`@ai-hero/sandcastle`** (homepage points at
> `github.com/mattpocock/sandcastle`). Always install the scoped name.

## How to run (operator)

```bash
# 1. Docker must be running (OrbStack)
docker info >/dev/null && echo "docker ok"
# 2. Export Codex creds (from 1Password "Goldberry Grove - Admin"); never commit
export OPENAI_API_KEY=...    # exact var per API Notes below
# 3. Run the spike
cd experiments/sandcastle-spike && pnpm install && pnpm spike
```

## API Notes (filled by Task 2)

Package: `@ai-hero/sandcastle` v0.7.0 — `main: dist/index.js`,
`types: dist/index.d.ts`, also ships a `sandcastle` CLI (`bin`).

**Recorded from `dist/index.d.ts` + README (the source of truth):**

- **Entry:** `import { run, codex, claudeCode, Output } from "@ai-hero/sandcastle"`;
  provider from a subpath: `import { docker } from "@ai-hero/sandcastle/sandboxes/docker"`
  (also `/podman`, `/vercel`, `/no-sandbox`).
- **`run(options)`** → `Promise<RunResult>`. Key options:
  - `agent: AgentProvider` — `codex(model, { effort?, env? })`,
    `claudeCode(model, { env? })`, also `pi()`, `cursor()`.
  - `sandbox: SandboxProvider` — `docker()` (bind-mount).
  - `cwd?: string` — host repo dir; anchors git ops + `.sandcastle/worktrees/`.
  - `prompt?: string` | `promptFile?: string` (mutually exclusive).
  - `branchStrategy?: BranchStrategy` — **named branch is `{ type: "branch", name }`**
    (not `"named"`); defaults to `{ type: "head" }` for bind-mount (docker).
  - `output?: OutputDefinition` — `Output.object({ tag, schema })` (schema is a
    StandardSchema → zod works) or `Output.string({ tag })`. **The prompt MUST
    contain the opening `<tag>` literal.** `maxIterations` must be `1`.
  - `completionSignal?` — default `"<promise>COMPLETE</promise>"`; the agent must
    emit it to end the iteration.
  - `idleTimeoutSeconds?` (default 600).
- **`RunResult`:** `{ iterations, stdout, commits: {sha}[], branch, output?,
  logFilePath?, preservedWorktreePath?, resume?, fork? }`. With `Output.object`,
  `result.output` is the typed, validated object.
- **Secrets → sandbox:** via the **agent factory's `env`** —
  `codex("gpt-5-codex", { env: { OPENAI_API_KEY } })`. Never committed.
- **Repo input:** `cwd` points at the host repo; bind-mount runs the agent in a
  git worktree under `.sandcastle/worktrees/`, so the main working tree stays
  clean and changes land on the strategy's branch.

**Findings worth flagging:**
1. **Package-name trap** (above): scoped `@ai-hero/sandcastle`, not `sandcastle`.
2. **Cost angle:** `claudeCode()` can run off a **Claude Max subscription**
   (README §3 / issue #191) — i.e. **$0** vs the metered Codex API. The spike
   uses `codex` to match the existing reasoning provider, but `claudeCode`+Max
   is the cheaper production option to weigh in the verdict.
3. `noSandbox()` provider exists — useful escape hatch if Docker isolation
   proves too heavy, at the cost of host isolation.

## Run Log (2026-06-06)

Each failure peeled one layer deeper and more real — exactly what a spike is for:

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | `pnpm add sandcastle` = wrong lib | bare `sandcastle` is an unrelated JS sandbox | install `@ai-hero/sandcastle` |
| 2 | `Image 'sandcastle:agenticos' not found` | Docker provider isn't zero-config | `sandcastle init` (scaffold `.sandcastle/`) + `sandcastle docker build-image` |
| 3 | `401 wss://…/v1/responses` | bare `OPENAI_API_KEY` → Codex defaults to the ChatGPT websocket transport | `onSandboxReady` hook: `codex login --with-api-key` (the Hermes pattern) |
| 4 | silent exit 1, no 401 | hook shell never saw the key (agent env ≠ hook env; no `.sandcastle/.env`) | write `OPENAI_API_KEY` into `.sandcastle/.env` |
| 5 | `Not inside a trusted directory…` | Codex safety gate; Sandcastle's `codex()` doesn't pass `--skip-git-repo-check` | pass the flag (manual repro) |
| 6 | `ERROR: Quota exceeded` | **OpenAI account/project has no available Codex spend** | add credit / budget-capped key |

**Manual repro confirming the full chain works** (`docker run … --entrypoint bash sandcastle:agenticos`):
`codex login --with-api-key` → `Successfully logged in`; `codex exec --skip-git-repo-check --model gpt-5-codex` → Codex v0.137.0 boots, authenticates, reaches the OpenAI API → stops only at `Quota exceeded`. Every Sandcastle/Codex layer passed.

## Verdict (2026-06-06): ADOPT — pending two non-fundamental fixes

The spike **technically validated** Sandcastle end-to-end on the Mac: install →
`init` → Docker image (Node 22 + Codex CLI) → sandbox launch on a named branch →
structured-output + lifecycle-hook APIs → Codex auth (`Successfully logged in`)
→ valid model → trust gate cleared → live OpenAI API call. The sandboxed,
branch-based, structured-output capability the dropped Phase 4 wanted **works**.

The agent never wrote the test only because of two blockers, **neither of which
is a Sandcastle defect**:

1. **OpenAI quota (billing, external).** The run died at `Quota exceeded` — the
   account/project key has no available Codex spend (it's valid: `/v1/models` →
   200). Fix: add credit, or use the **budget-capped project service-account
   key** discussed in the cost thread.
2. **Sandcastle ↔ Codex `--skip-git-repo-check` gap (upstream).** Sandcastle's
   `codex()` provider gives no way to pass `--skip-git-repo-check`, so in-sandbox
   `codex exec` aborts at Codex's trust gate. Manually the flag works. Fix: file
   an upstream issue to expose codex CLI args (or trust the dir via a
   `~/.codex/config.toml` hook), **or** use the `claudeCode` agent — Sandcastle's
   first-class path (but Anthropic automated = metered API key post-June-15).

**Adoption cost (the honest findings):** per-repo Docker image build/maintenance;
**Codex is a second-class citizen** in Sandcastle (auth needs the login hook, the
`--skip-git-repo-check` gap, and **opaque error surfacing** — Sandcastle truncates
Codex's real errors, which made debugging slow). `claudeCode` is the documented
happy path.

**Recommendation:** Sandcastle is **viable** for the parallel-dev-dispatch
capability. Before a production adoption: (a) provision a budget-capped OpenAI
project service-account key with quota; (b) resolve the `--skip-git-repo-check`
gap (upstream or `config.toml` hook); (c) re-run this spike for the green
"agent writes a passing test on a branch" confirmation. If the codex flag gap is
sticky, evaluate `claudeCode` (accepting metered Anthropic billing).
