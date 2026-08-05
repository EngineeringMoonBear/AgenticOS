# Agent PR Merge Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Paperclip agent PRs from requiring manual **Update branch** clicks, and stop a base-update from re-requesting human review.

**Architecture:** Four independent layers landed in the order 1 → 4 → 2 → 3. Layer 1 teaches `github-sync-plugin` to tell a GitHub-generated base-sync merge from real author commits, so the review issue is not reopened for work that did not change. Layer 4 moves the auto-merge gate decision out of inline bash into a testable script with blast-radius caps. Layer 2 replaces `strict: true` branch protection with a GitHub merge queue. Layer 3 dispatches genuine conflicts to the authoring agent instead of the operator.

**Tech Stack:** TypeScript (ESM, `node22` target, esbuild bundle), Vitest for plugin tests, standalone `node` ESM scripts for workflow-adjacent logic, Terraform (DigitalOcean + GitHub providers), GitHub Actions.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-03-agent-pr-merge-automation-design.md`.
- Base branch is `main` at `a51f48e` or later. Branch fresh from `origin/main` — never from `fix/tf-match-applied-state`.
- Plugin package is `packages/github-sync-plugin`, currently version `0.12.1`.
- **Any change under `packages/github-sync-plugin/src/` requires a `manifest.ts` version bump**, or the running plugin will not hot-reload on the droplet. Bump `package.json` and `src/manifest.ts` together — they must match (this exact drift was GOL-793).
- **No runtime DDL.** Schema changes go in migrations only, namespace-qualified.
- Plugin tests: `cd packages/github-sync-plugin && npx vitest run`.
- Plugin typecheck: `cd packages/github-sync-plugin && npx tsc --noEmit`.
- Plugin build: `cd packages/github-sync-plugin && npm run build` — commit the regenerated `dist/worker.js` and `dist/manifest.js`, they are tracked.
- Script tests follow the existing convention: `scripts/test-<name>.mjs`, run with `node scripts/test-<name>.mjs`, exit non-zero on failure.
- Commit with `PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit`.
- Do **not** merge any PR. Open it and stop.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/github-sync-plugin/src/github-client.ts` | **Modify** — add `getCommit()` |
| `packages/github-sync-plugin/src/pr-review.ts` | **Modify** — add `before`/`after` to the parsed event; add the pure `classifyHeadChange()` |
| `packages/github-sync-plugin/src/worker.ts` | **Modify** — consult the classifier before reopening a review |
| `packages/github-sync-plugin/tests/github-client.test.ts` | **Modify** — cover `getCommit()` |
| `packages/github-sync-plugin/tests/pr-review.test.ts` | **Modify** — cover parse fields + classifier |
| `scripts/automerge-gate.mjs` | **Create** — pure gate decision + CLI |
| `scripts/test-automerge-gate.mjs` | **Create** — gate unit tests |
| `.github/workflows/auto-approve.yml` | **Modify** — call the gate script instead of inline bash |
| `infra/terraform/github-branch-protection.tf` | **Create** — ruleset with merge queue, replacing classic protection |

---

## Task 1: `getCommit()` on GitHubClient

The classifier needs one thing GitHub already knows: the parents and committer of the new head commit. `GET /repos/{owner}/{repo}/commits/{sha}` returns both.

**Files:**
- Modify: `packages/github-sync-plugin/src/github-client.ts` (add method after `getPull`, ~line 329)
- Test: `packages/github-sync-plugin/tests/github-client.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GitHubClient.getCommit(repo: string, sha: string): Promise<Result<{ sha: string; parents: string[]; committerLogin: string }>>` — used by Task 4.

- [ ] **Step 1: Write the failing test**

Append to `packages/github-sync-plugin/tests/github-client.test.ts`:

```ts
describe("GitHubClient.getCommit", () => {
  it("returns parent SHAs in order and the committer login", async () => {
    const fetchMock = mockFetch({
      sha: "mergesha",
      parents: [{ sha: "beforesha" }, { sha: "basesha" }],
      committer: { login: "web-flow" },
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "mergesha");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        sha: "mergesha",
        parents: ["beforesha", "basesha"],
        committerLogin: "web-flow",
      });
    }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.github.com/repos/o/r/commits/mergesha");
  });

  it("tolerates a missing committer and absent parents", async () => {
    vi.stubGlobal("fetch", mockFetch({ sha: "s" }));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "s");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ sha: "s", parents: [], committerLogin: "" });
  });

  it("propagates a request failure", async () => {
    vi.stubGlobal("fetch", mockFetch({ message: "Not Found" }, false, 404));
    const client = new GitHubClient({ token: "t", org: "o", timeoutMs: 5000 });
    const result = await client.getCommit("r", "nope");
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/github-sync-plugin && npx vitest run tests/github-client.test.ts -t getCommit`
Expected: FAIL — `client.getCommit is not a function`

- [ ] **Step 3: Write minimal implementation**

Insert into `packages/github-sync-plugin/src/github-client.ts` immediately after the `getPull` method (after line 329):

```ts
  /**
   * Fetch a single commit's parents + committer. Used by the `synchronize`
   * classifier to tell a GitHub-generated base-sync merge (Update branch) from
   * real author commits: GitHub's update-branch produces a 2-parent merge whose
   * first parent is the previous PR head and whose committer is `web-flow`.
   * Requires only `contents:read`.
   */
  async getCommit(
    repo: string,
    sha: string,
  ): Promise<Result<{ sha: string; parents: string[]; committerLogin: string }>> {
    const res = await this.request<Record<string, any>>(
      "GET",
      repo,
      `/repos/${this.org}/${repo}/commits/${sha}`,
    );
    if (!res.ok) return res;
    const raw = res.data;
    const parents = Array.isArray(raw.parents) ? raw.parents : [];
    return {
      ok: true,
      data: {
        sha: String(raw.sha ?? ""),
        parents: parents.map((p: Record<string, any>) => String(p?.sha ?? "")),
        committerLogin: String(raw.committer?.login ?? ""),
      },
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/github-sync-plugin && npx vitest run tests/github-client.test.ts`
Expected: PASS, all existing github-client tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/github-sync-plugin/src/github-client.ts packages/github-sync-plugin/tests/github-client.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): add getCommit() for the synchronize classifier"
```

---

## Task 2: Parse `before`/`after` off the `pull_request` event

GitHub sends top-level `before` and `after` on a `synchronize` delivery. `parseGithubPrEvent` currently drops them.

**Files:**
- Modify: `packages/github-sync-plugin/src/pr-review.ts:46-90`
- Test: `packages/github-sync-plugin/tests/pr-review.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GithubPrEvent` gains `before: string` and `after: string` (empty string when absent). Used by Tasks 3 and 4.

- [ ] **Step 1: Write the failing test**

Append to `packages/github-sync-plugin/tests/pr-review.test.ts` inside the existing `describe("parseGithubPrEvent")` block:

```ts
  it("captures before/after on a synchronize delivery", () => {
    const ev = parseGithubPrEvent(
      prEvent({ action: "synchronize", before: "oldsha111", after: "newsha222" }),
    );
    expect(ev?.before).toBe("oldsha111");
    expect(ev?.after).toBe("newsha222");
  });

  it("defaults before/after to empty strings when absent", () => {
    const ev = parseGithubPrEvent(prEvent());
    expect(ev?.before).toBe("");
    expect(ev?.after).toBe("");
  });
```

The existing `it("maps a native pull_request payload")` test uses `toEqual` on the whole object and will now fail. Update its expected object to include the two new keys:

```ts
    expect(ev).toEqual({
      action: "opened",
      draft: false,
      repo: "Goldberry-Playground/AgenticOS",
      number: 260,
      title: "Add dashboard widget",
      headSha: "abc1234def5678",
      url: "https://github.com/Goldberry-Playground/AgenticOS/pull/260",
      before: "",
      after: "",
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/github-sync-plugin && npx vitest run tests/pr-review.test.ts -t parseGithubPrEvent`
Expected: FAIL — `before` is `undefined`, not `""`.

- [ ] **Step 3: Write minimal implementation**

In `packages/github-sync-plugin/src/pr-review.ts`, add two fields to the `GithubPrEvent` interface (after `url`, line 58):

```ts
  /** Previous head SHA on a `synchronize` delivery; "" on other actions. */
  before: string;
  /** New head SHA on a `synchronize` delivery; "" on other actions. */
  after: string;
```

And in the `return` block of `parseGithubPrEvent` (after the `url` line, ~line 88):

```ts
    before: typeof o.before === "string" ? o.before : "",
    after: typeof o.after === "string" ? o.after : "",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/github-sync-plugin && npx vitest run tests/pr-review.test.ts`
Expected: PASS, all pr-review tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/github-sync-plugin/src/pr-review.ts packages/github-sync-plugin/tests/pr-review.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): parse before/after off pull_request deliveries"
```

---

## Task 3: The pure `classifyHeadChange()` classifier

This is the heart of Layer 1 and it is I/O-free, so it is fully unit-testable.

**Rule:** a head change is a `base-sync` if and only if the new head commit has **exactly two parents**, its **first parent is the previous head**, and its **committer is `web-flow`** (GitHub's server-side committer for update-branch merges). A locally-authored merge has a real committer login and is therefore classified `author-work` — the fail-safe direction, because a manual merge can carry conflict resolutions that genuinely need review.

**Files:**
- Modify: `packages/github-sync-plugin/src/pr-review.ts` (append after `decideReviewAction`, ~line 107)
- Test: `packages/github-sync-plugin/tests/pr-review.test.ts`

**Interfaces:**
- Consumes: `GithubPrEvent` from Task 2.
- Produces:
  - `type HeadChangeKind = "base-sync" | "author-work"`
  - `const GITHUB_MERGE_COMMITTER = "web-flow"`
  - `function classifyHeadChange(input: { before: string; head: { parents: string[]; committerLogin: string } | null }): HeadChangeKind`

- [ ] **Step 1: Write the failing test**

Append to `packages/github-sync-plugin/tests/pr-review.test.ts`:

```ts
describe("classifyHeadChange", () => {
  const webflowMerge = { parents: ["beforesha", "basesha"], committerLogin: "web-flow" };

  it("classifies a GitHub Update-branch merge as base-sync", () => {
    expect(classifyHeadChange({ before: "beforesha", head: webflowMerge })).toBe("base-sync");
  });

  it("classifies an ordinary single-parent push as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha"], committerLogin: "agenticos-developer[bot]" },
      }),
    ).toBe("author-work");
  });

  it("classifies a locally-authored merge as author-work (may carry conflict resolutions)", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha", "basesha"], committerLogin: "EngineeringMoonBear" },
      }),
    ).toBe("author-work");
  });

  it("classifies a force-push (first parent is not `before`) as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["someothersha", "basesha"], committerLogin: "web-flow" },
      }),
    ).toBe("author-work");
  });

  it("fails toward author-work when the head commit could not be fetched", () => {
    expect(classifyHeadChange({ before: "beforesha", head: null })).toBe("author-work");
  });

  it("fails toward author-work when `before` is unknown", () => {
    expect(classifyHeadChange({ before: "", head: webflowMerge })).toBe("author-work");
  });

  it("classifies an octopus merge as author-work", () => {
    expect(
      classifyHeadChange({
        before: "beforesha",
        head: { parents: ["beforesha", "b", "c"], committerLogin: "web-flow" },
      }),
    ).toBe("author-work");
  });
});
```

Add `classifyHeadChange` to the import list at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/github-sync-plugin && npx vitest run tests/pr-review.test.ts -t classifyHeadChange`
Expected: FAIL — `classifyHeadChange is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `packages/github-sync-plugin/src/pr-review.ts` after `decideReviewAction`:

```ts
/**
 * What kind of head-SHA change a `synchronize` delivery represents.
 *  - "base-sync"   → the base moved under the PR (GitHub "Update branch"); the
 *                    author contributed nothing, so a re-review is pure noise.
 *  - "author-work" → anything else; run the normal review pipeline.
 */
export type HeadChangeKind = "base-sync" | "author-work";

/**
 * GitHub's server-side committer login for merges it creates on the user's
 * behalf (Update branch, squash-merge). A locally-authored merge carries the
 * pusher's own login instead.
 */
export const GITHUB_MERGE_COMMITTER = "web-flow";

/**
 * Classify a head change. GitHub's Update-branch produces a two-parent merge
 * whose FIRST parent is the previous PR head, whose second is the base, and
 * whose committer is `web-flow`.
 *
 * Deliberately asymmetric on failure: anything we cannot positively identify as
 * a base-sync is treated as author work. A spurious re-review is an annoyance;
 * a silently-skipped review is a correctness hole.
 */
export function classifyHeadChange(input: {
  before: string;
  head: { parents: string[]; committerLogin: string } | null;
}): HeadChangeKind {
  const { before, head } = input;
  if (!before || !head) return "author-work";
  if (head.parents.length !== 2) return "author-work";
  if (head.parents[0] !== before) return "author-work";
  if (head.committerLogin !== GITHUB_MERGE_COMMITTER) return "author-work";
  return "base-sync";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/github-sync-plugin && npx vitest run tests/pr-review.test.ts`
Expected: PASS — 7 new assertions green, existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/github-sync-plugin/src/pr-review.ts packages/github-sync-plugin/tests/pr-review.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): classify base-sync vs author-work head changes"
```

---

## Task 4: Wire the classifier into the PR webhook

`handlePrInbound` currently runs the full reviewer loop on every actionable action. Add a short-circuit: on `synchronize`, fetch the head commit, classify, and return early on `base-sync`.

Placed **after** the bridge/config guards (so we have a `github` client) and **before** `listPullFiles` (so a base-sync costs one cheap API call instead of the whole pipeline).

**Files:**
- Modify: `packages/github-sync-plugin/src/worker.ts` — insert after the `makeBridgeGithubClient` guard (currently ends line 886), before the `captureInvocationScope()` call
- Modify: `packages/github-sync-plugin/src/manifest.ts` — version bump
- Modify: `packages/github-sync-plugin/package.json` — version bump

**Interfaces:**
- Consumes: `classifyHeadChange` (Task 3), `GithubPrEvent.before`/`.after` (Task 2), `GitHubClient.getCommit` (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Add the classifier import**

In `packages/github-sync-plugin/src/worker.ts`, add `classifyHeadChange` to the existing import block from `./pr-review.js`.

- [ ] **Step 2: Insert the short-circuit**

Immediately after the `makeBridgeGithubClient` guard block (the one ending `return; }` for "no auth for bridge"), insert:

```ts
  // Layer 1 (GOL — merge automation): a `synchronize` whose new head is a
  // GitHub-generated base-sync merge ("Update branch") carries no author work.
  // Reopening the review issue for it is what produced the ~202 junk "Review PR"
  // twins and re-pinged the operator for unchanged code. One cheap commit fetch
  // decides it; anything we cannot positively identify as a base-sync falls
  // through to the normal pipeline.
  if (ev.action === "synchronize") {
    const headSha = ev.after || ev.headSha;
    const commitRes = await github.getCommit(bridge.githubRepo, headSha);
    if (!commitRes.ok) {
      ctx.logger.warn("pr webhook: head commit fetch failed — treating as author work", {
        repo: ev.repo,
        number: ev.number,
        headSha,
        error: commitRes.error,
      });
    }
    const kind = classifyHeadChange({
      before: ev.before,
      head: commitRes.ok
        ? { parents: commitRes.data.parents, committerLogin: commitRes.data.committerLogin }
        : null,
    });
    if (kind === "base-sync") {
      ctx.logger.info("pr webhook: base-sync (Update branch) — skipping re-review", {
        repo: ev.repo,
        number: ev.number,
        before: ev.before,
        after: headSha,
      });
      return;
    }
  }
```

- [ ] **Step 3: Bump the plugin version**

Set `version` to `0.13.0` in **both** `packages/github-sync-plugin/package.json` and the `version` field in `packages/github-sync-plugin/src/manifest.ts`. They must match — mismatched versions were GOL-793, and without a bump the droplet will not hot-reload the worker.

- [ ] **Step 4: Typecheck, test, build**

Run:
```bash
cd packages/github-sync-plugin && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: typecheck clean, all tests pass, `dist/worker.js` and `dist/manifest.js` regenerated.

- [ ] **Step 5: Verify the version bump landed in dist**

Run: `grep -c '0\.13\.0' packages/github-sync-plugin/dist/manifest.js`
Expected: at least `1`. If `0`, the build did not pick up the manifest change — re-run `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add packages/github-sync-plugin/src/worker.ts packages/github-sync-plugin/src/manifest.ts \
        packages/github-sync-plugin/package.json packages/github-sync-plugin/dist/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): skip re-review on base-sync synchronize (0.13.0)"
```

- [ ] **Step 7: Open the Layer 1 PR**

```bash
git push -u origin feat/github-sync-denoise-synchronize
gh pr create --title "feat(github-sync): skip re-review on base-sync synchronize (0.13.0)" --body "Layer 1 of docs/superpowers/specs/2026-08-03-agent-pr-merge-automation-design.md. An Update-branch merge no longer reopens the review issue or re-pings. Classifier is I/O-free and unit-tested; fails toward treating a change as author work."
```

STOP after opening. Do not merge.

---

## Task 5: Merge gate — blast-radius caps in a testable script

Move the gate decision out of inline bash. The script is pure given its inputs, so it can be tested without GitHub.

**Files:**
- Create: `scripts/automerge-gate.mjs`
- Create: `scripts/test-automerge-gate.mjs`
- Modify: `.github/workflows/auto-approve.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `evaluateGate(input): { allow: boolean; reason: string }` where `input` is
  `{ authorLogin: string; changedFiles: string[]; additions: number; deletions: number; sensitiveGate: boolean; maxLines: number; maxFiles: number }`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-automerge-gate.mjs`:

```js
// test-automerge-gate.mjs — unit test for the auto-merge gate decision.
// Run: node scripts/test-automerge-gate.mjs
import assert from "node:assert/strict";
import { evaluateGate } from "./automerge-gate.mjs";

const base = {
  authorLogin: "agenticos-developer[bot]",
  changedFiles: ["src/a.ts"],
  additions: 10,
  deletions: 2,
  sensitiveGate: false,
  maxLines: 800,
  maxFiles: 25,
};

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.error(`NOT OK - ${name}\n  ${e.message}`); }
};

check("allows a small agent PR", () => {
  assert.equal(evaluateGate(base).allow, true);
});

check("rejects a non-agent author", () => {
  const r = evaluateGate({ ...base, authorLogin: "somehuman" });
  assert.equal(r.allow, false);
  assert.match(r.reason, /not the agent App bot/);
});

check("accepts the bare app slug too", () => {
  assert.equal(evaluateGate({ ...base, authorLogin: "app/agenticos-developer" }).allow, true);
});

check("rejects when total changed lines exceed maxLines", () => {
  const r = evaluateGate({ ...base, additions: 900, deletions: 0 });
  assert.equal(r.allow, false);
  assert.match(r.reason, /900 changed lines/);
});

check("counts deletions toward the line cap", () => {
  const r = evaluateGate({ ...base, additions: 500, deletions: 400 });
  assert.equal(r.allow, false);
});

check("rejects when changed-file count exceeds maxFiles", () => {
  const files = Array.from({ length: 26 }, (_, i) => `src/f${i}.ts`);
  const r = evaluateGate({ ...base, changedFiles: files });
  assert.equal(r.allow, false);
  assert.match(r.reason, /26 changed files/);
});

check("allows exactly at the caps (bounds are inclusive)", () => {
  const files = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
  assert.equal(evaluateGate({ ...base, changedFiles: files, additions: 800, deletions: 0 }).allow, true);
});

check("sensitive gate OFF permits a workflow edit", () => {
  assert.equal(evaluateGate({ ...base, changedFiles: [".github/workflows/ci.yml"] }).allow, true);
});

check("sensitive gate ON blocks a workflow edit", () => {
  const r = evaluateGate({ ...base, sensitiveGate: true, changedFiles: [".github/workflows/ci.yml"] });
  assert.equal(r.allow, false);
  assert.match(r.reason, /sensitive path/);
});

check("sensitive gate ON blocks infra, compose, broker and Dockerfiles", () => {
  for (const f of [
    "infra/terraform/main.tf",
    "docker-compose.yml",
    "scripts/agent-git/helper.sh",
    "packages/credential-broker/src/index.ts",
    "apps/dashboard/Dockerfile",
    ".gitleaks.toml",
  ]) {
    const r = evaluateGate({ ...base, sensitiveGate: true, changedFiles: [f] });
    assert.equal(r.allow, false, `expected ${f} to be blocked`);
  }
});

check("sensitive gate ON still allows ordinary paths", () => {
  assert.equal(evaluateGate({ ...base, sensitiveGate: true, changedFiles: ["src/a.ts"] }).allow, true);
});

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test-automerge-gate.mjs`
Expected: FAIL — `Cannot find module './automerge-gate.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/automerge-gate.mjs`:

```js
// automerge-gate.mjs — decides whether an agent PR may auto-merge.
//
// Extracted from inline bash in .github/workflows/auto-approve.yml so the
// decision is unit-testable (scripts/test-automerge-gate.mjs). The workflow
// still owns "are all checks green"; this owns author, size, and path policy.
//
// CLI: node scripts/automerge-gate.mjs
//   env: PR_AUTHOR, PR_FILES (newline-separated), PR_ADDITIONS, PR_DELETIONS,
//        AUTOMERGE_SENSITIVE_GATE (on|off), AUTOMERGE_MAX_LINES, AUTOMERGE_MAX_FILES
//   exit 0 = allow, exit 1 = skip (reason on stdout)

/** Authors permitted to auto-merge: the Paperclip agent App bot, both spellings. */
const AGENT_AUTHORS = new Set(["agenticos-developer", "app/agenticos-developer", "agenticos-developer[bot]"]);

/**
 * Security finding M2 (PR #359): CI is not an adversarial-code gate. A
 * prompt-injected agent editing these paths could self-ship. Mirrors
 * .github/CODEOWNERS — keep both in sync.
 */
const SENSITIVE = [
  /^\.github\//,
  /^infra\//,
  /^docker-compose/,
  /^scripts\/agent-git\//,
  /^packages\/credential-broker\//,
  /^\.gitleaks\.toml$/,
  /(^|\/)Dockerfile/,
];

export function evaluateGate(input) {
  const { authorLogin, changedFiles, additions, deletions, sensitiveGate, maxLines, maxFiles } = input;

  if (!AGENT_AUTHORS.has(authorLogin)) {
    return { allow: false, reason: `author '${authorLogin}' is not the agent App bot; human and external PRs keep human review` };
  }

  if (changedFiles.length > maxFiles) {
    return { allow: false, reason: `${changedFiles.length} changed files exceeds AUTOMERGE_MAX_FILES=${maxFiles}` };
  }

  const lines = additions + deletions;
  if (lines > maxLines) {
    return { allow: false, reason: `${lines} changed lines exceeds AUTOMERGE_MAX_LINES=${maxLines}` };
  }

  if (sensitiveGate) {
    const hit = changedFiles.find((f) => SENSITIVE.some((re) => re.test(f)));
    if (hit) {
      return { allow: false, reason: `sensitive path '${hit}' — AUTOMERGE_SENSITIVE_GATE is on` };
    }
  }

  return { allow: true, reason: `${changedFiles.length} files / ${lines} lines within caps` };
}

// CLI entrypoint — only when executed directly, not when imported by the test.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const result = evaluateGate({
    authorLogin: (process.env.PR_AUTHOR ?? "").trim(),
    changedFiles: (process.env.PR_FILES ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    additions: num(process.env.PR_ADDITIONS, 0),
    deletions: num(process.env.PR_DELETIONS, 0),
    sensitiveGate: (process.env.AUTOMERGE_SENSITIVE_GATE ?? "off").toLowerCase() === "on",
    maxLines: num(process.env.AUTOMERGE_MAX_LINES, 800),
    maxFiles: num(process.env.AUTOMERGE_MAX_FILES, 25),
  });
  console.log(result.reason);
  process.exit(result.allow ? 0 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test-automerge-gate.mjs`
Expected: `all checks passed`, exit 0.

- [ ] **Step 5: Wire the workflow to the script**

In `.github/workflows/auto-approve.yml`, replace the Gate 1 block (the `SENSITIVE=$(gh pr view ...)` stanza through its closing `fi`) with:

```bash
          # ── Gate 1: author + blast-radius + optional sensitive-path policy ──
          # Decision lives in scripts/automerge-gate.mjs so it is unit-tested
          # (scripts/test-automerge-gate.mjs). Gate 2 below still owns "all
          # checks green", which needs live API state.
          PR_JSON=$(gh pr view "$PR" --repo "$REPO" --json author,files,additions,deletions)
          export PR_AUTHOR=$(echo "$PR_JSON" | jq -r '.author.login')
          export PR_FILES=$(echo "$PR_JSON" | jq -r '.files[].path')
          export PR_ADDITIONS=$(echo "$PR_JSON" | jq -r '.additions')
          export PR_DELETIONS=$(echo "$PR_JSON" | jq -r '.deletions')
          export AUTOMERGE_SENSITIVE_GATE="${{ vars.AUTOMERGE_SENSITIVE_GATE || 'off' }}"
          export AUTOMERGE_MAX_LINES="${{ vars.AUTOMERGE_MAX_LINES || '800' }}"
          export AUTOMERGE_MAX_FILES="${{ vars.AUTOMERGE_MAX_FILES || '25' }}"

          if ! REASON=$(node scripts/automerge-gate.mjs); then
            echo "PR #$PR not eligible for auto-merge: $REASON"
            exit 0
          fi
          echo "gate passed: $REASON"
```

Because the workflow now runs repository code, add a checkout step as the job's **first** step (it currently has none).

**Pin `ref: main` — never the PR head.** This workflow's whole security model is that it runs from the base-branch definition (`workflow_run`), so a PR cannot modify the logic that approves it. Checking out `github.event.workflow_run.head_branch` would hand that back to the PR and let it rewrite its own gate:

```yaml
      - name: Check out base-branch scripts
        uses: actions/checkout@v5
        with:
          ref: main
          persist-credentials: false
```

Also delete the now-duplicated author check (the `case "$AUTHOR" in` block) — `evaluateGate` owns it.

- [ ] **Step 6: Lint the workflow**

Run: `npx --yes actionlint .github/workflows/auto-approve.yml` (or `actionlint` if installed)
Expected: no errors. If actionlint is unavailable locally, CI's `actionlint` job covers it.

- [ ] **Step 7: Commit and open the Layer 4 PR**

```bash
git add scripts/automerge-gate.mjs scripts/test-automerge-gate.mjs .github/workflows/auto-approve.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(ci): blast-radius caps + configurable sensitive gate for auto-merge"
git push -u origin feat/automerge-blast-radius-caps
gh pr create --title "feat(ci): blast-radius caps + configurable sensitive gate for auto-merge" --body "Layer 4 of the merge-automation spec. Gate decision moves from inline bash to scripts/automerge-gate.mjs with unit tests. Adds AUTOMERGE_MAX_LINES (800) and AUTOMERGE_MAX_FILES (25); AUTOMERGE_SENSITIVE_GATE defaults off per operator decision, reversing security finding M2 deliberately — it is a repo variable so re-arming needs no code change."
```

STOP after opening. This PR touches `.github/`, so it will not auto-merge — that is correct.

- [ ] **Step 8: Note the required repo variables for the operator**

These are **not** set by this PR. Report to the operator that after merge they may optionally set, at `Settings → Secrets and variables → Actions → Variables`: `AUTOMERGE_SENSITIVE_GATE`, `AUTOMERGE_MAX_LINES`, `AUTOMERGE_MAX_FILES`. All three have working defaults, so no action is required for the workflow to function.

---

## Task 6: Merge queue ruleset, replacing `strict`

**Files:**
- Create: `infra/terraform/github-branch-protection.tf`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no code exports; changes repository configuration.

- [ ] **Step 1: Record the current protection so it can be restored**

Run:
```bash
gh api repos/EngineeringMoonBear/AgenticOS/branches/main/protection > /tmp/main-protection-backup.json
cat /tmp/main-protection-backup.json | jq '{strict: .required_status_checks.strict, contexts: .required_status_checks.contexts}'
```
Expected: `strict: true`, contexts `["Lint","Typecheck","Unit tests","Build"]`. Keep this file — it is the rollback.

- [ ] **Step 2: Confirm the GitHub provider is already configured**

Run: `grep -rn 'source *= *"integrations/github"' infra/terraform/`
Expected: a provider block exists. **If it does not**, this task additionally requires adding the provider and a token — stop and report that to the operator rather than inventing credentials.

- [ ] **Step 3: Write the ruleset**

Create `infra/terraform/github-branch-protection.tf`:

```hcl
# main-branch protection as a ruleset (Layer 2 of the merge-automation spec).
#
# Replaces classic branch protection, which cannot express a merge queue.
# `strict` (require-branches-up-to-date) is deliberately GONE: it forced a manual
# "Update branch" on every open PR after each merge, and the queue supersedes it
# by building and testing the prospective merge commit itself.
resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = "AgenticOS"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion         = true
    non_fast_forward = true
    required_linear_history = true

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check { context = "Lint" }
      required_check { context = "Typecheck" }
      required_check { context = "Unit tests" }
      required_check { context = "Build" }
    }

    merge_queue {
      check_response_timeout_minutes    = 60
      grouping_strategy                 = "ALLGREEN"
      max_entries_to_build              = 5
      max_entries_to_merge              = 5
      merge_method                      = "SQUASH"
      min_entries_to_merge              = 1
      min_entries_to_merge_wait_minutes = 5
    }
  }
}
```

- [ ] **Step 4: Validate**

Run:
```bash
cd infra/terraform && terraform init -backend=false && terraform validate
```
Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Plan and inspect for replacement**

Run: `cd infra/terraform && terraform plan`
Expected: one resource to **create** (`github_repository_ruleset.main`).

**Grep the plan for `forces replacement` and `must be replaced` before proceeding.** If either appears against a droplet or any stateful resource, STOP and report — that is the odoocker-style ForceNew trap and is not part of this change.

- [ ] **Step 6: Commit and open the Layer 2 PR**

```bash
git add infra/terraform/github-branch-protection.tf
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "infra(github): main ruleset with merge queue, dropping strict"
git push -u origin infra/main-merge-queue-ruleset
gh pr create --title "infra(github): main ruleset with merge queue, dropping strict" --body "Layer 2 of the merge-automation spec. Replaces classic branch protection with a ruleset carrying a merge queue (squash, batch 5, 5-min fill, ALLGREEN). Drops strict: the queue tests the prospective merge commit, which catches semantic conflicts strict structurally cannot. Rollback: the pre-change protection JSON is captured in the PR discussion."
```

Paste the contents of `/tmp/main-protection-backup.json` into a PR comment as the rollback record.

- [ ] **Step 7: Operator handoff — apply and disable classic protection**

Terraform apply and the removal of classic branch protection are **operator actions**, not agent actions. Report:
1. `terraform apply` creates the ruleset.
2. Classic protection on `main` must then be **disabled manually** — a ruleset and classic protection both applying to `main` compose, and the classic `strict: true` would keep forcing Update-branch.
3. Delete the dormant `ClaudeLimits` ruleset (id `16479528`) in the same pass.
4. Verify afterwards: `gh api repos/EngineeringMoonBear/AgenticOS/branches/main/protection --jq '.required_status_checks.strict'` should error (no classic protection) rather than return `true`.

---

## Task 7: Conflict dispatch to the authoring agent

On `push` to `main`, find open agent PRs that now conflict and hand them to their author agent.

**Files:**
- Create: `packages/github-sync-plugin/src/conflict-dispatch.ts`
- Create: `packages/github-sync-plugin/tests/conflict-dispatch.test.ts`
- Modify: `packages/github-sync-plugin/src/worker.ts` — call it from the existing hourly reconcile job
- Modify: `packages/github-sync-plugin/src/manifest.ts` + `package.json` — version bump to `0.14.0`

**Interfaces:**
- Consumes: `GitHubClient` from Task 1's module; `SyncLogger` from `./sync.js`; `DEFAULT_AGENT_PR_AUTHOR` from `./ci-failure.js`.
- Produces:
  - `type MergeableState = "clean" | "dirty" | "unknown" | "other"`
  - `function shouldDispatch(state: MergeableState, alreadyDispatchedForBase: boolean): boolean`
  - `function dispatchKey(prNumber: number, baseSha: string): string`
  - `interface ConflictSweepInput` / `interface ConflictSweepSummary`
  - `function runConflictSweep(input: ConflictSweepInput): Promise<ConflictSweepSummary>`
  - `function buildConflictSweepPing(s: ConflictSweepSummary): string`
- Also modifies: `GitHubClient.getPull()` gains `mergeableState: string` (see Step 8).

**Placement decision:** ride the **existing hourly `mirror-reconcile` sweep** added by PR #444 rather than adding a second `push`-on-main trigger. This resolves the spec's one open item — a second trigger would duplicate scheduling and double the API budget for no gain, and conflict repair is not latency-sensitive.

- [ ] **Step 1: Write the failing test**

Create `packages/github-sync-plugin/tests/conflict-dispatch.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldDispatch, dispatchKey, type MergeableState } from "../src/conflict-dispatch.js";

describe("shouldDispatch", () => {
  it("dispatches a conflicted PR not yet dispatched for this base", () => {
    expect(shouldDispatch("dirty", false)).toBe(true);
  });

  it("does not re-dispatch for the same base SHA", () => {
    expect(shouldDispatch("dirty", true)).toBe(false);
  });

  it("never dispatches a clean PR", () => {
    expect(shouldDispatch("clean", false)).toBe(false);
  });

  it("never dispatches on unknown — mergeability is computed async", () => {
    expect(shouldDispatch("unknown", false)).toBe(false);
  });

  it("never dispatches on an unrecognised state", () => {
    expect(shouldDispatch("other", false)).toBe(false);
  });
});

describe("dispatchKey", () => {
  it("keys on PR number and base SHA", () => {
    expect(dispatchKey(446, "abc1234")).toBe("446@abc1234");
  });

  it("distinguishes bases so a later main move re-dispatches", () => {
    expect(dispatchKey(446, "abc1234")).not.toBe(dispatchKey(446, "def5678"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/github-sync-plugin && npx vitest run tests/conflict-dispatch.test.ts`
Expected: FAIL — cannot resolve `../src/conflict-dispatch.js`

- [ ] **Step 3: Write minimal implementation**

Create `packages/github-sync-plugin/src/conflict-dispatch.ts`:

```ts
/**
 * Layer 3 of the merge-automation spec: route genuine merge conflicts to the
 * agent that authored the PR instead of to the operator.
 *
 * Pure decision logic only; the worker owns the GitHub + Paperclip I/O. Runs
 * inside the hourly mirror-reconcile sweep (PR #444) rather than on its own
 * push trigger — conflict repair is not latency-sensitive and a second trigger
 * would duplicate scheduling for no gain.
 */

/** GitHub's `mergeable_state`, narrowed to what the decision cares about. */
export type MergeableState = "clean" | "dirty" | "unknown" | "other";

/**
 * Dispatch only on a positively-known conflict that we have not already handed
 * off for this base SHA.
 *
 * `unknown` never dispatches: GitHub computes mergeability asynchronously, so
 * `unknown` means "ask again", not "conflicted". Treating it as a conflict
 * would spam agents with phantom rebase work on every sweep.
 */
export function shouldDispatch(state: MergeableState, alreadyDispatchedForBase: boolean): boolean {
  if (state !== "dirty") return false;
  return !alreadyDispatchedForBase;
}

/**
 * Idempotency key. Keyed on base SHA (not just PR number) so ten pushes to main
 * produce one dispatch, while a genuinely new base after the agent's fix does
 * re-dispatch.
 */
export function dispatchKey(prNumber: number, baseSha: string): string {
  return `${prNumber}@${baseSha}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/github-sync-plugin && npx vitest run tests/conflict-dispatch.test.ts`
Expected: PASS — 7 assertions green.

- [ ] **Step 5: Commit the pure layer**

```bash
git add packages/github-sync-plugin/src/conflict-dispatch.ts packages/github-sync-plugin/tests/conflict-dispatch.test.ts
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): conflict-dispatch decision logic"
```

- [ ] **Step 6: Add the sweep, injected-deps style**

`runMirrorReconcile` iterates **Paperclip issues**, not GitHub PRs, so the conflict check does not belong inside it. Add a **sibling** sweep that the same registered job calls — this shares the hourly schedule (no second trigger, per the spec's open item) while keeping two independently testable units.

Append to `packages/github-sync-plugin/src/conflict-dispatch.ts`:

```ts
export interface ConflictSweepInput {
  /** Open agent-authored PRs to examine: { repo, number, baseSha }. */
  openPrs: ReadonlyArray<{ repo: string; number: number; baseSha: string }>;
  /** Fetch GitHub's current mergeable_state for one PR. */
  getMergeableState: (repo: string, number: number) => Promise<MergeableState>;
  /** Has this (PR, base SHA) already been handed off? */
  wasDispatched: (key: string) => Promise<boolean>;
  /** Record a handoff so the next sweep does not repeat it. */
  recordDispatched: (key: string) => Promise<void>;
  /** Reopen the PR's review issue assigned to its authoring agent. */
  dispatchRebase: (pr: { repo: string; number: number }) => Promise<void>;
  logger: SyncLogger;
}

export interface ConflictSweepSummary {
  scanned: number;
  dispatched: number;
  alreadyDispatched: number;
  failed: number;
}

/**
 * One pass over open agent PRs, handing conflicted ones to their authoring
 * agent. Per-PR failures are counted and logged, never thrown — one bad PR
 * cannot kill the sweep (same guard rail as runMirrorReconcile).
 */
export async function runConflictSweep(input: ConflictSweepInput): Promise<ConflictSweepSummary> {
  const summary: ConflictSweepSummary = { scanned: 0, dispatched: 0, alreadyDispatched: 0, failed: 0 };

  for (const pr of input.openPrs) {
    summary.scanned++;
    try {
      const state = await input.getMergeableState(pr.repo, pr.number);
      const key = dispatchKey(pr.number, pr.baseSha);
      const already = await input.wasDispatched(key);
      if (!shouldDispatch(state, already)) {
        if (state === "dirty" && already) summary.alreadyDispatched++;
        continue;
      }
      await input.dispatchRebase({ repo: pr.repo, number: pr.number });
      await input.recordDispatched(key);
      summary.dispatched++;
    } catch (err) {
      summary.failed++;
      input.logger.error("conflict-sweep: dispatch failed; continuing sweep", {
        repo: pr.repo,
        number: pr.number,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

/** Ops-channel one-liner; only worth posting when something was dispatched. */
export function buildConflictSweepPing(s: ConflictSweepSummary): string {
  return `🔀 conflict-sweep: handed ${s.dispatched} conflicted PR(s) to their authoring agent, ${s.failed} failed (scanned ${s.scanned})`;
}
```

Add the `SyncLogger` import at the top of the file:

```ts
import type { SyncLogger } from "./sync.js";
```

- [ ] **Step 7: Test the sweep**

Append to `packages/github-sync-plugin/tests/conflict-dispatch.test.ts`:

```ts
import { runConflictSweep, buildConflictSweepPing } from "../src/conflict-dispatch.js";

const noopLogger = { info() {}, warn() {}, error() {} } as any;

describe("runConflictSweep", () => {
  const pr = { repo: "o/r", number: 446, baseSha: "base1" };

  it("dispatches a conflicted PR once and records it", async () => {
    const dispatched: number[] = [];
    const recorded: string[] = [];
    const summary = await runConflictSweep({
      openPrs: [pr],
      getMergeableState: async () => "dirty",
      wasDispatched: async () => false,
      recordDispatched: async (k) => void recorded.push(k),
      dispatchRebase: async (p) => void dispatched.push(p.number),
      logger: noopLogger,
    });
    expect(dispatched).toEqual([446]);
    expect(recorded).toEqual(["446@base1"]);
    expect(summary).toMatchObject({ scanned: 1, dispatched: 1, failed: 0 });
  });

  it("does not re-dispatch when already handed off for this base", async () => {
    let calls = 0;
    const summary = await runConflictSweep({
      openPrs: [pr],
      getMergeableState: async () => "dirty",
      wasDispatched: async () => true,
      recordDispatched: async () => {},
      dispatchRebase: async () => void calls++,
      logger: noopLogger,
    });
    expect(calls).toBe(0);
    expect(summary).toMatchObject({ dispatched: 0, alreadyDispatched: 1 });
  });

  it("leaves clean and unknown PRs alone", async () => {
    let calls = 0;
    for (const state of ["clean", "unknown"] as const) {
      await runConflictSweep({
        openPrs: [pr],
        getMergeableState: async () => state,
        wasDispatched: async () => false,
        recordDispatched: async () => {},
        dispatchRebase: async () => void calls++,
        logger: noopLogger,
      });
    }
    expect(calls).toBe(0);
  });

  it("counts a failure and continues to the next PR", async () => {
    const seen: number[] = [];
    const summary = await runConflictSweep({
      openPrs: [pr, { repo: "o/r", number: 447, baseSha: "base1" }],
      getMergeableState: async () => "dirty",
      wasDispatched: async () => false,
      recordDispatched: async () => {},
      dispatchRebase: async (p) => {
        if (p.number === 446) throw new Error("boom");
        seen.push(p.number);
      },
      logger: noopLogger,
    });
    expect(seen).toEqual([447]);
    expect(summary).toMatchObject({ scanned: 2, dispatched: 1, failed: 1 });
  });
});

describe("buildConflictSweepPing", () => {
  it("summarises a sweep", () => {
    expect(buildConflictSweepPing({ scanned: 5, dispatched: 2, alreadyDispatched: 1, failed: 0 }))
      .toContain("handed 2 conflicted PR(s)");
  });
});
```

Run: `cd packages/github-sync-plugin && npx vitest run tests/conflict-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 8: Wire into the existing job**

In `packages/github-sync-plugin/src/worker.ts`, the `mirror-reconcile` job is registered at **line 1519** and calls `runMirrorReconcile` at 1525. Inside that same registered callback, after the existing reconcile summary is logged (~line 1533), call `runConflictSweep` with adapters:

- `openPrs` — open agent-authored PRs across bridged repos. Reuse `DEFAULT_AGENT_PR_AUTHOR` (already exported from `./ci-failure.js`) for the author filter.
- `getMergeableState` — call `github.getPull()`; map GitHub's `mergeable_state` string onto `MergeableState`: `"dirty"` → `"dirty"`, `"clean"`/`"has_hooks"`/`"unstable"` → `"clean"`, `"unknown"` → `"unknown"`, anything else → `"other"`. **`getPull` currently does not return `mergeable_state`** — extend it the same way Task 1 extended the client, with a test.
- `wasDispatched` / `recordDispatched` — a namespace-qualified table. **No runtime DDL**: add a migration following the existing pattern in the package, the same way `github_pr_review` and `github_sync_mapping` are defined.
- `dispatchRebase` — reopen the PR's review issue to `todo` assigned to the authoring agent, with a body explaining the conflict and naming the base SHA.

Post `buildConflictSweepPing` only when `summary.dispatched > 0` **and** `wantPing(cfg, "outcome")`, matching how `buildReconcilePing` is gated at line 1535.

- [ ] **Step 9: Bump version, verify, and open the Layer 3 PR**

```bash
# set version to 0.14.0 in BOTH package.json and src/manifest.ts
cd packages/github-sync-plugin && npx tsc --noEmit && npx vitest run && npm run build && cd ../..
git add packages/github-sync-plugin/
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(github-sync): dispatch merge conflicts to the authoring agent (0.14.0)"
git push -u origin feat/github-sync-conflict-dispatch
gh pr create --title "feat(github-sync): dispatch merge conflicts to the authoring agent (0.14.0)" --body "Layer 3 of the merge-automation spec. Rides the existing hourly mirror-reconcile sweep rather than adding a second push trigger — resolves the spec's open item. Dispatch is idempotent per (PR, base SHA); unknown mergeability never dispatches."
```

STOP after opening.

---

## Deferred: extracting `handlePrInbound` from `worker.ts`

The spec lists, as in-scope cleanup, moving the PR-review and dispatch logic out of `worker.ts` (1,633 lines) rather than growing it further. **This plan partially honours that and defers the rest, deliberately.**

What it does: all new logic lands in dedicated modules — the classifier in `pr-review.ts`, the sweep in a new `conflict-dispatch.ts`, the gate in `scripts/automerge-gate.mjs`. Net new code in `worker.ts` across all four layers is roughly 25 lines of call-site wiring.

What it defers: extracting the existing ~130-line `handlePrInbound` into its own module. A pure-move refactor of that function would touch the same region every one of the four layer PRs edits, guaranteeing conflicts between them — the exact failure mode this whole spec exists to eliminate. Doing it concurrently would be self-defeating.

**Do it as a separate, behaviour-free PR after Layer 3 lands**, with no logic changes in the same commit so the diff is reviewable as a pure move. If it is skipped entirely, `worker.ts` grows by ~25 lines rather than shrinking — an acceptable outcome, but not the spec's stated intent, so it should be a conscious decision rather than an oversight.

## Verification after all four layers are merged and deployed

- [ ] **Live smoke.** Open a throwaway agent-authored PR against `main`. Merge an unrelated PR to `main`. Assert: no Update-branch was required, the review issue was **not** reopened, no ops ping fired for the base move, and the PR merged through the queue.
- [ ] **Confirm the junk-twin source is closed.** After a week, check that no new "Review PR" mirror issues were created for base-updates.
- [ ] **Confirm plugin version live.** `gh workflow run deploy-droplet-plugins.yml`, then verify the registry reports `0.14.0` — a worker-only change without a manifest bump does not hot-reload.

## Rollback

| Layer | Rollback |
|---|---|
| 1 | Revert the PR; the classifier is additive and the pipeline returns to reopening on every `synchronize`. |
| 4 | Revert the PR, or set `AUTOMERGE_MAX_LINES`/`AUTOMERGE_MAX_FILES` very high and `AUTOMERGE_SENSITIVE_GATE=on`. |
| 2 | `terraform destroy -target=github_repository_ruleset.main`, then restore classic protection from `/tmp/main-protection-backup.json`. |
| 3 | Revert the PR; the sweep returns to mirror-reconcile only. |
