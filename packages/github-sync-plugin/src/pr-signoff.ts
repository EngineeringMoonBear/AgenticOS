/**
 * Phase 3 prerequisite (GOL-186) — plugin-side agent-review sign-off completion.
 *
 * The PR review pipeline (pr-review.ts / worker.ts) only ever SEEDS a pending
 * `agent-review/*` check-run (seedPendingCheck). Nothing completed it to success:
 * the seed docblock assumed the reviewing agent's own tooling would post the
 * sign-off check, and that tooling does not exist in the reviewer runtime. So a
 * `agent-review/*` check stays `in_progress` forever even after the reviewer's
 * Paperclip issue closes (verified on PR #295 — alice's check never left pending).
 * Phase 3 (GOL-159) makes `agent-review/alice` the single globally-required check
 * (fail-closed); against a pending-forever check that would block every merge.
 *
 * This module completes the check-run SERVER-SIDE and event-driven (Option 2):
 * when a Paperclip review issue reaches its terminal `done` state, an
 * `issue.updated` dispatch calls handleReviewSignoff, which re-evaluates the gate
 * for the PR and posts the green check-run(s) using the Developer App's
 * `checks:write` (GOL-175). Least-privilege: keeps `checks:write` OFF the broad
 * "agents" App and needs no reviewer-side HMAC endpoint.
 */
import type { SyncDeps } from "./sync.js";
import {
  buildPipelineErrorPing,
  buildSignoffPing,
  CHECK_CONTEXT,
  evaluateSignoffGate,
  shortSha,
  type Reviewer,
} from "./pr-review.js";
import { getReviewRecord, getReviewRecordByIssueId, type PrReviewRow } from "./pr-review-store.js";

/**
 * Complete `agent-review/*` check-runs when a review issue reaches sign-off.
 *
 * Registered as a SECOND `issue.updated` dispatch alongside handleIssueUpdated and
 * independent of it: the mirror path early-returns on unmapped issues (review
 * issues carry no github_sync_mapping row), and this path early-returns on issues
 * with no github_pr_review row (mirror issues). So the two never collide.
 *
 * Flow:
 *  1. Reverse-look up the review record for the updated issue. None → not a review
 *     issue, ignore quietly.
 *  2. Act only when the triggering review issue is `done` (its terminal sign-off).
 *     This ties the check-run post + Discord ping to a real transition, not every
 *     metadata edit; a reopen-to-`todo` (synchronize) or a `cancelled`
 *     non-approval leaves the check pending — fail-closed under the Phase 3 gate.
 *  3. Load both reviewers' rows for the (repo, PR), read each reviewer's issue
 *     status, and evaluate the pure gate (evaluateSignoffGate).
 *  4. Post each greenlit check-run on ITS row's current head SHA. A synchronize
 *     resets rows + reopens issues to `todo`, so a `done` issue is necessarily done
 *     against the current head — a stale head can't satisfy the gate. Re-posting is
 *     idempotent (the latest check-run of a name wins); we ✅-ping the checks this
 *     event greenlit.
 */
export async function handleReviewSignoff(
  deps: SyncDeps,
  input: { issueId: string; companyId: string },
): Promise<void> {
  const { db, logger, getIssue } = deps;

  const record = await getReviewRecordByIssueId(db, input.issueId);
  if (!record) return; // not a review issue — the mirror path owns the rest

  const triggerIssue = await getIssue(input.issueId, input.companyId);
  if (!triggerIssue) {
    logger.warn("signoff: review issue not readable; skipping", { issueId: input.issueId });
    return;
  }
  if (triggerIssue.status !== "done") return; // sign-off is the review issue closing `done`

  const aliceRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "alice");
  const irisRow = await getReviewRecord(db, record.githubRepo, record.prNumber, "iris");

  const aliceDone = aliceRow ? await isIssueDone(deps, aliceRow, input.companyId) : false;
  const irisDone = irisRow ? await isIssueDone(deps, irisRow, input.companyId) : false;

  const greenlit = evaluateSignoffGate({ aliceDone, irisPresent: irisRow !== null, irisDone });
  if (greenlit.length === 0) {
    logger.info("signoff: gate not yet green; no check-run posted", {
      repo: record.githubRepo,
      prNumber: record.prNumber,
      aliceDone,
      irisPresent: irisRow !== null,
      irisDone,
    });
    return;
  }

  for (const reviewer of greenlit) {
    const row = reviewer === "alice" ? aliceRow : irisRow;
    if (!row) continue; // the gate never greenlights a reviewer without a row; be safe
    await postSignoffCheck(deps, row, reviewer);
  }
}

async function isIssueDone(deps: SyncDeps, row: PrReviewRow, companyId: string): Promise<boolean> {
  const issue = await deps.getIssue(row.paperclipIssueId, companyId);
  return issue?.status === "done";
}

/**
 * Post a green `agent-review/<reviewer>` check-run on the row's head SHA. The repo
 * for the API call is the bridge's bare repo name (config.githubRepo) — the client
 * builds `/repos/<org>/<repo>/...` — while the row's `githubRepo` (owner/repo) is
 * used only for human-facing display. On success we ✅-ping; on API failure we log
 * and 🔥-ping so a stuck-pending required check is never silent.
 */
async function postSignoffCheck(deps: SyncDeps, row: PrReviewRow, reviewer: Reviewer): Promise<void> {
  const { github, config, logger } = deps;
  const res = await github.createCheckRun(config.githubRepo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: row.headSha,
    conclusion: "success",
    title: `Agent review complete (${reviewer})`,
    summary: `${reviewer} signed off ${row.githubRepo}#${row.prNumber} @ \`${shortSha(row.headSha)}\` (GOL-186).`,
  });
  if (!res.ok) {
    logger.error("signoff: check-run completion failed", {
      repo: row.githubRepo,
      prNumber: row.prNumber,
      reviewer,
      headSha: row.headSha,
      error: res.error,
    });
    await deps.postOpsPing?.(
      buildPipelineErrorPing(
        `sign-off check-run failed for ${row.githubRepo}#${row.prNumber} (${reviewer}): ${res.error}`,
      ),
    );
    return;
  }
  logger.info("signoff: posted green check-run", {
    repo: row.githubRepo,
    prNumber: row.prNumber,
    reviewer,
    headSha: row.headSha,
    checkRunId: res.data.id,
  });
  await deps.postOpsPing?.(buildSignoffPing(reviewer, row.githubRepo, row.prNumber));
}
