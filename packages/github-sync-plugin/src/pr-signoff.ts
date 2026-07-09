/**
 * Agent-review sign-off completion (GOL-186, Phase-3 prerequisite of GOL-159).
 *
 * The PR pipeline only ever SEEDS a pending `agent-review/*` check-run
 * (`seedPendingCheck` in worker.ts). Nothing completed it to success — so the
 * Phase-3 merge gate (which makes `agent-review/alice` the single globally
 * required check, fail-closed) would block every merge forever.
 *
 * This module closes that gap SERVER-SIDE (Option 2, least-privilege): when a
 * Paperclip review issue reaches `done`, the plugin posts the terminal check-run
 * via the Developer App's already-granted `checks:write` (GOL-175). No new
 * permission on the broadly-used "agents" App and no reviewer-side HMAC endpoint.
 *
 * Gate rule (spec System 2): `agent-review/iris` is informational; the REQUIRED
 * `agent-review/alice` only goes green when Alice's review is done AND — when a
 * frontend (Iris) review issue exists for the same PR — Iris's is done too. That
 * keeps exactly one globally-required check while still guaranteeing frontend
 * changes were reviewed. The two reviewers can finish in either order: whichever
 * `issue.updated` lands last re-evaluates the gate and posts the alice success.
 */
import type { GitHubClient } from "./github-client.js";
import type { SyncDeps } from "./sync.js";
import {
  getReviewRecord,
  getReviewRecordByIssueId,
  type PrReviewRow,
} from "./pr-review-store.js";
import { CHECK_CONTEXT, buildSignoffPing, shortSha, type Reviewer } from "./pr-review.js";

/** A check-run this evaluation decided to complete to success. */
export interface SignoffAction {
  reviewer: Reviewer;
  headSha: string;
  prNumber: number;
}

/**
 * Pure gate evaluation — decides which `agent-review/*` check-runs should be
 * completed to success given the current state of the two review rows. Kept
 * side-effect free so the truth table is unit-testable.
 *
 * - `iris` success: the Iris review issue is done (informational check).
 * - `alice` success (REQUIRED): the Alice review issue is done AND either there
 *   is no Iris review row, or the Iris review issue is done too — and, when Iris
 *   exists, both rows point at the same head SHA (guards a mid-`synchronize`
 *   race where one row already advanced to a new head).
 */
export function evaluateSignoff(state: {
  alice: { row: PrReviewRow; done: boolean } | null;
  iris: { row: PrReviewRow; done: boolean } | null;
}): SignoffAction[] {
  const actions: SignoffAction[] = [];
  const { alice, iris } = state;

  if (iris && iris.done) {
    actions.push({ reviewer: "iris", headSha: iris.row.headSha, prNumber: iris.row.prNumber });
  }

  if (alice && alice.done) {
    const irisSatisfied = !iris || iris.done;
    const headsAligned = !iris || iris.row.headSha === alice.row.headSha;
    if (irisSatisfied && headsAligned) {
      actions.push({ reviewer: "alice", headSha: alice.row.headSha, prNumber: alice.row.prNumber });
    }
  }

  return actions;
}

/** Post the terminal success check-run for one reviewer + emit the ✅ ping. */
async function completeCheck(
  deps: SyncDeps,
  github: GitHubClient,
  repo: string,
  action: SignoffAction,
): Promise<void> {
  const context = CHECK_CONTEXT[action.reviewer];
  const res = await github.createCheckRun(repo, {
    name: context,
    headSha: action.headSha,
    conclusion: "success",
    title: `Agent review: ${action.reviewer} signed off`,
    summary: `${action.reviewer} approved ${repo}#${action.prNumber} @ \`${shortSha(action.headSha)}\` (review issue done).`,
  });
  if (!res.ok) {
    deps.logger.error("pr sign-off: failed to post success check-run", {
      repo,
      reviewer: action.reviewer,
      prNumber: action.prNumber,
      error: res.error,
    });
    return;
  }
  deps.logger.info("pr sign-off: posted success check-run", {
    repo,
    reviewer: action.reviewer,
    prNumber: action.prNumber,
    context,
  });
  await deps.opsPing?.(buildSignoffPing(action.reviewer, repo, action.prNumber));
}

/**
 * `issue.updated` handler for the sign-off path. No-ops unless the updated issue
 * is a tracked review issue that just reached `done`; then it re-evaluates the
 * gate for the whole PR and completes any newly-green check-runs. Idempotent:
 * re-posting an already-green check is harmless (latest check-run of a name wins).
 */
export async function handleReviewSignoff(
  deps: SyncDeps,
  input: { issueId: string; companyId: string },
): Promise<void> {
  const { db, github, logger } = deps;

  const row = await getReviewRecordByIssueId(db, input.issueId);
  if (!row) return; // not a review issue — the mirror-sync path handles the rest

  const triggering = await deps.getIssue(input.issueId, input.companyId);
  if (!triggering) {
    logger.warn("pr sign-off: review issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  // Only act when a review reaches done. Non-terminal transitions (reopen on
  // synchronize, in-progress) leave the pending check as-is; cancelled leaves it
  // pending too (an emergency admin bypass, not a sign-off).
  if (triggering.status !== "done") return;

  const [aliceRow, irisRow] = await Promise.all([
    getReviewRecord(db, row.githubRepo, row.prNumber, "alice"),
    getReviewRecord(db, row.githubRepo, row.prNumber, "iris"),
  ]);

  const doneOf = async (r: PrReviewRow | null): Promise<boolean> => {
    if (!r) return false;
    if (r.paperclipIssueId === input.issueId) return triggering.status === "done";
    const issue = await deps.getIssue(r.paperclipIssueId, input.companyId);
    return issue?.status === "done";
  };
  const [aliceDone, irisDone] = await Promise.all([doneOf(aliceRow), doneOf(irisRow)]);

  const actions = evaluateSignoff({
    alice: aliceRow ? { row: aliceRow, done: aliceDone } : null,
    iris: irisRow ? { row: irisRow, done: irisDone } : null,
  });

  for (const action of actions) {
    await completeCheck(deps, github, row.githubRepo, action);
  }
}
