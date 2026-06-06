# Sandcastle Spike Implementation Plan

> **For agentic workers:** This is a **local, manual spike**, not production code.
> Most tasks (scaffold, record API, write `run.ts`, write verdict) are
> agent-doable; the two RUN tasks (Docker sandbox + Codex) are **operator steps**
> Josh runs by hand — they're marked **🧑‍💻 OPERATOR**. Steps use checkbox
> (`- [ ]`) syntax. Do NOT dispatch this to parallel subagents — it's a
> read-the-output-and-judge loop.

**Goal:** Prove (or disprove) that `mattpocock/sandcastle` can run a Codex agent
in a local Docker sandbox, make a real verifiable code change to AgenticOS, and
return a branch + structured result — yielding an adopt/reshape/drop verdict.

**Architecture:** A throwaway `experiments/sandcastle-spike/` workspace with one
`run.ts` that calls `sandcastle.run()` (Docker provider, Codex agent, named
branch, structured output). Nothing under `apps/`/`packages/` is touched. The
agent's task: add a passing `vitest` test for an untested pure helper.

**Tech Stack:** TypeScript, `tsx`, `sandcastle` (npm), Docker via OrbStack,
Codex (gpt-5-codex) via `OPENAI_API_KEY`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md`

---

## Task 1: Scaffold the throwaway experiment workspace

**Files:**
- Create: `experiments/sandcastle-spike/package.json`
- Create: `experiments/sandcastle-spike/README.md`
- Create: `experiments/sandcastle-spike/.gitignore`

- [ ] **Step 1: Create the workspace package.json**

```json
{
  "name": "sandcastle-spike",
  "private": true,
  "version": "0.0.0",
  "description": "THROWAWAY spike — evaluate mattpocock/sandcastle. Delete if verdict is 'drop'.",
  "type": "module",
  "scripts": {
    "spike": "tsx run.ts"
  }
}
```

- [ ] **Step 2: Create `.gitignore` (keep node_modules + any sandbox scratch out of git)**

```gitignore
node_modules/
*.log
.sandcastle/
```

- [ ] **Step 3: Create the README skeleton (the verdict lives here)**

```markdown
# Sandcastle Spike

Throwaway evaluation of `mattpocock/sandcastle`. See the spec:
`docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md`.

## How to run (operator)

```bash
# 1. Docker must be running (OrbStack)
docker info >/dev/null && echo "docker ok"
# 2. Export Codex creds (from 1Password "Goldberry Grove - Admin"); never commit
export OPENAI_API_KEY=...    # or the codex auth env the lib expects (see API Notes)
# 3. Run the spike
cd experiments/sandcastle-spike && pnpm install && pnpm spike
```

## API Notes (filled by Task 2)

_TBD — recorded in Task 2._

## Run Log (filled by Task 5)

_TBD — pasted in Task 5._

## Verdict (filled by Task 7)

_TBD — adopt / reshape / drop, with reasoning._
```

> Note: the three `_TBD_` markers above are **intentional fill-in slots** for
> later tasks in THIS plan — they are not unfinished plan steps.

- [ ] **Step 4: Confirm pnpm sees the new workspace** (root `pnpm-workspace.yaml`
  likely globs `apps/*` + `packages/*`; add `experiments/*` if needed)

Run: `grep -n "experiments" pnpm-workspace.yaml || echo "needs adding"`
If it prints "needs adding", append `  - "experiments/*"` under `packages:` in
`pnpm-workspace.yaml`.

- [ ] **Step 5: Commit**

```bash
git add experiments/sandcastle-spike/ pnpm-workspace.yaml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "spike(sandcastle): scaffold throwaway experiment workspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Install Sandcastle and record its REAL API (the critical task)

The spec was written from a web summary — **do not trust remembered API shapes.**
This task pins reality before any `run.ts` is written.

**Files:**
- Modify: `experiments/sandcastle-spike/package.json` (adds the dep)
- Modify: `experiments/sandcastle-spike/README.md` (the "API Notes" section)

- [ ] **Step 1: Install the library**

```bash
cd experiments/sandcastle-spike && pnpm add sandcastle tsx
```
Expected: `sandcastle` + `tsx` appear in `package.json` dependencies; lockfile updates.

- [ ] **Step 2: Read the README + bundled types**

```bash
ls node_modules/sandcastle
sed -n '1,200p' node_modules/sandcastle/README.md
# the type surface — the source of truth for option names:
find node_modules/sandcastle -name "*.d.ts" | head
sed -n '1,250p' "$(find node_modules/sandcastle -name '*.d.ts' | head -1)"
```

- [ ] **Step 3: Record the real API in README.md → "API Notes"**, answering
  EACH of these (copy the exact signatures/identifiers from the `.d.ts`):
  1. `sandcastle.run(...)` — exact option object shape (field names + types).
  2. Docker provider — how it's constructed/named (e.g. a `docker()` factory? a
     `provider: "docker"` string? an imported class?).
  3. Branch strategy — the option name + how to request a **named** branch.
  4. Agent selection — how to pick **Codex** (string id? factory? what env/flags?).
  5. Structured output — the mechanism (a schema option? a parsed return field?)
     and the shape of what `run()` resolves to.
  6. Secret/env injection — how `OPENAI_API_KEY` (or codex auth) reaches the
     sandbox container.
  7. Source/repo input — how the working tree gets into the sandbox (clone? mount?).
  8. Any required Docker image / setup hooks.

  If any of these **can't** be determined from README + types, write
  "UNKNOWN — try empirically in Task 5" next to it. That's a valid finding.

- [ ] **Step 4: Commit**

```bash
git add experiments/sandcastle-spike/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "spike(sandcastle): install lib + record real API surface

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Write `run.ts` against the recorded API

**Files:**
- Create: `experiments/sandcastle-spike/run.ts`

- [ ] **Step 1: Write `run.ts`** using the EXACT identifiers recorded in Task 2.
  The skeleton below is the **intended shape** — replace each `/* Task 2: … */`
  marker with the real option name/value from the API Notes (do not invent names):

```ts
// Throwaway spike. Runs a Codex agent in a local Docker sandbox to add a
// passing vitest test to the AgenticOS repo, on a named branch.
import { run } from "sandcastle"; // ← Task 2: confirm the real import

const REPO_ROOT = new URL("../../", import.meta.url).pathname; // monorepo root
const BRANCH = `spike/sandcastle-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const PROMPT = `You are working inside a checkout of the AgenticOS monorepo.
Find ONE small, currently-untested, exported PURE function in
apps/dashboard/lib/ (no I/O, no React). Write a focused vitest test next to it
(\`*.test.ts\`) covering its main behavior and one edge case. Run the test with
\`pnpm --filter dashboard exec vitest run <the new test file>\` and ensure it
PASSES. Do not modify the function itself. Keep the change minimal.`;

async function main() {
  const result = await run({
    /* Task 2: provider */    // e.g. provider: docker()
    /* Task 2: agent=Codex */ // e.g. agent: codex()
    /* Task 2: source repo */ // e.g. source: REPO_ROOT
    /* Task 2: named branch */// e.g. branch: { strategy: "named", name: BRANCH }
    /* Task 2: env inject  */ // e.g. env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! }
    /* Task 2: structured  */ // e.g. outputSchema: { ... }
    prompt: PROMPT,
  });

  console.log("=== SANDCASTLE SPIKE RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("=== branch:", BRANCH);
}

main().catch((e) => {
  console.error("spike failed:", e);
  process.exit(1);
});
```

> The `/* Task 2: … */` comments are **fill-from-Task-2 markers**, not vague
> placeholders — Task 2 produced the exact values; this step substitutes them.

- [ ] **Step 2: Typecheck it compiles** (no run yet — just that the API calls are real)

```bash
cd experiments/sandcastle-spike && pnpm exec tsc --noEmit run.ts 2>&1 | head
```
Expected: no errors about unknown `run` options (if there are, the Task 2 notes
were wrong — go fix them, then this).

- [ ] **Step 3: Commit**

```bash
git add experiments/sandcastle-spike/run.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "spike(sandcastle): run.ts — Codex-in-Docker adds a vitest test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 🧑‍💻 OPERATOR — prerequisites check

Run on the Mac. (The agent can't drive Docker-in-a-sandbox, so Josh runs this.)

- [ ] **Step 1: Docker (OrbStack) is up**

```bash
docker info >/dev/null 2>&1 && echo "docker ok" || open -a OrbStack
```

- [ ] **Step 2: Export Codex credentials** (from 1Password "Goldberry Grove -
  Admin"; the exact var name comes from Task 2's API Notes — likely `OPENAI_API_KEY`)

```bash
export OPENAI_API_KEY="$(op read 'op://Goldberry Grove - Admin/OpenAI/api_key' 2>/dev/null || echo PASTE_HERE)"
[ -n "$OPENAI_API_KEY" ] && echo "key exported (len ${#OPENAI_API_KEY})"
```

---

## Task 5: 🧑‍💻 OPERATOR — run the spike + capture output

- [ ] **Step 1: Run it**

```bash
cd experiments/sandcastle-spike && pnpm install && pnpm spike 2>&1 | tee /tmp/sandcastle-spike.log
```

- [ ] **Step 2: Paste the result into README.md → "Run Log"** — the printed
  structured result, the branch name, and (if the lib couldn't do something) the
  error. A failure here is a legitimate finding, not a blocker.

- [ ] **Step 3: Commit the run log**

```bash
git add experiments/sandcastle-spike/README.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "spike(sandcastle): capture run log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Verify the success criteria

Check each (from the spec). Record pass/fail in the Run Log.

- [ ] **Step 1: The branch exists with a sensible diff**

```bash
git branch --list 'spike/sandcastle-*'
git log --oneline main..spike/sandcastle-* 2>/dev/null | head
git diff --stat main..spike/sandcastle-* 2>/dev/null
```
Expected: a `spike/sandcastle-*` branch with a new `*.test.ts` file.

- [ ] **Step 2: The host working tree is clean** (change lives only on the branch)

```bash
git status --porcelain | grep -v '^??' || echo "host tree clean ✓"
```

- [ ] **Step 3: The structured result has `completed: true`** (or the lib's
  equivalent) and lists the changed file — confirm in the Run Log.

- [ ] **Step 4: The new test actually passes** (run it yourself on the branch to
  confirm the agent didn't fake green)

```bash
git stash -u 2>/dev/null; git checkout spike/sandcastle-*
pnpm --filter dashboard exec vitest run "$(git diff --name-only main | grep '\.test\.ts$')"
git checkout main
```
Expected: the new test passes.

---

## Task 7: Write the verdict

**Files:**
- Modify: `experiments/sandcastle-spike/README.md` (the "Verdict" section)

- [ ] **Step 1: Write a one-paragraph verdict** — **adopt / reshape / drop** —
  answering: did the sandbox run? did Codex auth reach it? did it produce a real
  passing test on a branch? was the structured output usable for telemetry later?
  what friction (image build time, dep install in-sandbox, secret handling)
  would the production version face? If "adopt/reshape", name the next phase
  (parallel dispatch + telemetry wiring per the spec's "decision the spike
  informs"). If "drop", say why and note that `experiments/sandcastle-spike/`
  plus the code/brand "code-agent lane" refs can be deleted.

- [ ] **Step 2: Commit**

```bash
git add experiments/sandcastle-spike/README.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "spike(sandcastle): verdict

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push + open a PR for the spike record** (the experiment + verdict
  are worth landing on main as a documented evaluation, even if the verdict is
  "drop")

```bash
git push -u origin docs/sandcastle-spike-plan  # or the spike branch you committed on
gh pr create --title "spike(sandcastle): mattpocock/sandcastle evaluation + verdict" \
  --body "Throwaway spike per docs/superpowers/specs/2026-06-06-sandcastle-spike-design.md. Verdict in experiments/sandcastle-spike/README.md."
```

- [ ] **Step 4 (optional, operator): open a DRAFT PR for the agent-produced
  branch** to eyeball what Codex actually did — `gh pr create --draft --head
  spike/sandcastle-<ts>`. Do NOT merge it; it's a spike artifact.

---

## Out of scope (do NOT build in this plan)

Parallel/multi-agent dispatch · Postgres `Task/Session/Call` telemetry wiring ·
scheduling/systemd · Droplet deploy · replacing Hermes/`run_codex` · the Vercel
provider. Each is a follow-up **only if** the verdict is adopt/reshape.

## Self-review notes

- **Spec coverage:** every spec acceptance criterion maps to a task — scaffold
  (T1), API pinning (T2), `run.ts` (T3), operator run (T4–5), the 5 success
  criteria (T6), verdict deliverable (T7). ✓
- **Placeholders:** the only `_TBD_`/`/* Task 2 */` markers are _explicit
  fill-from-prior-task slots_ unique to a spike whose first task discovers the
  API — flagged as such inline, not vague hand-waving.
- **Scope:** single throwaway workspace; out-of-scope list mirrors the spec. ✓
