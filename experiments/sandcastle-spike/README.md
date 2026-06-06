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

## Run Log (filled by Task 5)

_Recorded in Task 5._

## Verdict (filled by Task 7)

_adopt / reshape / drop — recorded in Task 7._
