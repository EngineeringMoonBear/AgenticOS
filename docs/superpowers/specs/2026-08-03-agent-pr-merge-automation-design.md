# Agent PR merge automation — design

- **Date:** 2026-08-03
- **Status:** Proposed
- **Repo:** `EngineeringMoonBear/AgenticOS`

## Problem

Paperclip agents open PRs into this repo faster than the merge gate lets them land. Every merge to `main` invalidates every other open PR, each then needs a manual **Update branch**, and that update itself re-triggers a review cycle. The operator cost is three-fold:

1. Clicking Update branch on PR after PR.
2. Being re-asked to review work that has not changed.
3. PRs sitting long enough to drift into real conflicts.

CI compute is explicitly *not* a concern. Human attention is the scarce resource.

## Root cause

Two mechanisms compound each other.

**`main` branch protection sets `strict: true`** ("require branches to be up to date before merging"), alongside required checks `Lint`, `Typecheck`, `Unit tests`, `Build`, linear history, and no required reviewers. With N open agent PRs, each merge invalidates the other N−1. Clearing the queue is O(N²) updates in the worst case, and the queue never drains while agents keep opening PRs.

**`synchronize` is treated as new work.** In `packages/github-sync-plugin/src/pr-review.ts`:

```ts
export const PR_ACTIONS: readonly string[] = ["opened", "reopened", "ready_for_review", "synchronize"];
```

and `worker.ts` reopens the review issue to `todo`, posts a "new commits" comment, and fires an ops ping whenever the head SHA changes. A branch update carrying **zero new author commits** is indistinguishable from real work.

So one merge to `main` costs N Update-branch clicks *and* N reopened review issues *and* N Discord pings. This is the likely origin of the ~202 junk "Review PR" GitHub twins.

## Goals

- No human clicks Update branch for a non-conflicting agent PR, ever.
- A base-update never re-requests review and never pings.
- Real conflicts route to the authoring agent, not the operator.
- Merge safety does not regress.

## Non-goals

- Reducing CI spend.
- Changing how non-agent (human or external) PRs are reviewed.
- Any change to `grove-sites`, `odoocker-goldberrygrove`, or `grove-odoo-modules`.

## Design

Four layers, independently shippable, in the order given.

| Layer | Where | Solves |
|---|---|---|
| 1. De-noise | `github-sync-plugin` | Base-updates reopening review issues + pinging |
| 2. Merge queue | repo ruleset (Terraform) | The Update-branch convoy |
| 3. Conflict dispatch | `github-sync-plugin` | PRs going stale / conflicting |
| 4. Merge gate | `.github/workflows/auto-approve.yml` | What lands hands-free |

### Layer 1 — De-noise `synchronize`

A classifier answers one question: *did this push carry new author work, or did the base just move?*

`update-branch` produces a merge commit with exactly two parents — `parent[0]` is the previous head, `parent[1]` is reachable from base. On `synchronize`, compare `before...after`; if every commit in the range fits that shape, classify as **base-sync**: skip the reopen, skip the comment, skip the ops ping. Anything else is real work and flows unchanged.

**Failure is asymmetric by design.** If the compare call fails or the shape is ambiguous, classify as **real work and notify**. A spurious ping is an annoyance; a silently-missed re-review is a correctness hole. Ambiguous classifications are logged so their true frequency is measurable rather than assumed.

This layer alone removes the review-churn pain and is independent of Layers 2–4.

### Layer 2 — Merge queue

Migrate `main` from classic branch protection to a repository ruleset; classic protection cannot express merge queue. Carry over required checks (`Lint`, `Typecheck`, `Unit tests`, `Build`), linear history, no force-push, no delete. **Drop `strict`** — the queue makes it redundant by construction.

Queue configuration:

- merge method: **squash** (matches current repo setting)
- maximum PRs to build: **5**
- minimum PRs to merge: **1**
- wait time to fill a batch: **5 minutes**
- merge if checks fail: **no**

Codified in `infra/terraform/`, not clicked. The dormant `ClaudeLimits` ruleset is deleted in the same pass rather than left as a decoy.

**This is a safety improvement, not a relaxation.** Today `strict` proves each PR was green against a base that may already be stale by the time it merges. The queue runs required checks against the *actual prospective merge commit*, catching semantic conflicts that `strict` structurally cannot. Batching is a side benefit: five queued PRs become one CI run.

Merge queue is available because this repo is **public**; it requires GitHub Team or Enterprise on private repos.

### Layer 3 — Conflict dispatch

On `push` to `main`, walk open agent PRs and read `mergeable_state`.

GitHub computes mergeability asynchronously, so `unknown` gets bounded retry with backoff — never treated as clean. On `dirty`, reopen the PR's work issue assigned to the **authoring agent** with a rebase instruction. The agent resolves the conflict; the operator is not involved.

The same handler covers merge-queue **ejection** (queue build failed), since that is the same concept: this PR needs its author's attention.

Idempotency keys on `(PR number, base SHA)`, so ten pushes to `main` produce one dispatch. Throttling reuses the existing `OpsPingThrottle`.

### Layer 4 — Merge gate

Per operator decision, green CI is sufficient to merge and the sensitive-path carve-out is **off by default**.

It is implemented as a repo variable rather than deleted:

| Variable | Default | Effect |
|---|---|---|
| `AUTOMERGE_SENSITIVE_GATE` | `off` | When `on`, restores the security-finding-M2 carve-out (`.github/`, `infra/`, `docker-compose*`, `scripts/agent-git/`, `packages/credential-broker/`, Dockerfiles) |
| `AUTOMERGE_MAX_LINES` | `800` | Over this additions+deletions total → skip auto-merge |
| `AUTOMERGE_MAX_FILES` | `25` | Over this changed-file count → skip auto-merge |

Both size dimensions are enforced because they fail differently: a 3-line change across 40 files carries different risk than an 800-line change in one file, and either bound alone leaves a hole.

Unchanged: the PR author must be the agent App bot (this is what keeps public drive-by PRs routed to a human), and *all* checks on the head SHA must be green, not just `CI`.

**Accepted risk, recorded deliberately.** Turning the carve-out off reverses security finding M2 (PR #359, merged 2026-07-13). Its reasoning was that CI is not an adversarial-code gate: a prompt-injected agent editing `.github/` or `packages/credential-broker/` could self-ship to production on green CI alone. The size cap does not cover this — a three-line workflow edit is small and maximally dangerous. The variable exists so re-arming is a settings toggle, not a code change.

The gate decision moves out of inline bash into a script under `scripts/` that the workflow invokes. Bash embedded in YAML is untestable and this logic now has enough branches to warrant unit tests.

## Data flow

1. Agent opens PR → CI runs → gate script validates (author, size caps, all-green) → approve + `gh pr merge --auto --squash` → PR enters the merge queue when ready.
2. Queue builds the prospective merge commit, runs required checks on it, merges. No Update-branch occurs.
3. Queue build fails → PR ejected → Layer 3 dispatches the authoring agent.
4. PR conflicts with `main` → Layer 3 detects on `push` → dispatches the authoring agent.
5. Base-update `synchronize` events → Layer 1 classifies as base-sync → no reopen, no ping.

## Error handling

- **Mergeability `unknown`** — bounded retry with backoff; never treated as clean.
- **Compare API failure (Layer 1)** — classify as real work and notify; log the fallback.
- **Repeated pushes** — dispatch idempotency on `(PR number, base SHA)`.
- **Queue misconfigured or unavailable** — auto-merge degrades to current behaviour (PR waits for a click). Degradation is visible, never a silent merge.

## Testing

- Table-driven unit tests for the Layer 1 classifier: base-update, real commit, force-push, mixed range, ambiguous.
- Unit tests for the gate script: author check, each size bound independently, carve-out on and off.
- Idempotency tests for Layer 3 dispatch.
- Replayed webhook payloads for both `synchronize` flavours.
- One live smoke: open a throwaway agent PR, merge to `main`, assert no reopen, no ping, clean queue merge.

## Rollout order

1. **Layer 1** — safe, immediate relief, independent of everything else.
2. **Layer 4** — size caps and gate variables.
3. **Layer 2** — the ruleset migration; do it when it can be watched.
4. **Layer 3** — conflict dispatch.

Layer 2 is sequenced third deliberately: it is the only step that modifies branch protection on `main`, and Layers 1 and 4 deliver most of the felt improvement without that risk.

## Prerequisites

- **PR #446 resolved.** Done — merged 2026-08-03 as `ac4dadd`. It touched `worker.ts`, `pr-signoff.ts`, and `sync.ts`, the same files Layer 1 edits.
- **Work from fresh `origin/main`.** The prior local checkout sat 34 commits behind on `fix/tf-match-applied-state`, whose PR merged 2026-07-20.

## In-scope cleanup

`worker.ts` exceeds 1,200 lines. The PR-review and dispatch logic moves to its own module rather than growing that file further. This is scoped to the code this design already edits — not a general refactor.

## Open items

- Layer 3's `push`-on-`main` subscription may overlap the PR #444 hourly reconcile sweep. Confirm during implementation whether dispatch should ride the existing sweep instead of adding a second trigger.
