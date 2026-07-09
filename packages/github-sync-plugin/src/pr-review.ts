/**
 * Phase 2 — agent PR review pipeline (plugin v0.7.0, GOL-158). Spec
 * docs/superpowers/specs/2026-07-08-discipline-routing-agent-pr-review-design.md
 * System 2. Parent GOL-150.
 *
 * Pure, I/O-free logic for the `github-pr` webhook: parse GitHub's native
 * `pull_request` event, filter the actionable action set, decide which reviewers
 * apply (Alice always; Iris when a changed path matches `frontendPaths`), build
 * the review-issue title/body + loop-prevention marker, and format the low-noise
 * state-change Discord pings (spec System 3). Everything here is unit-tested; the
 * worker wires it to GitHub + Paperclip I/O.
 */

/** The reviewing agents. Alice always reviews; Iris only when frontend paths change. */
export type Reviewer = "alice" | "iris";

/** Check-run context per reviewer (sign-off on the PR head SHA; spec System 2). */
export const CHECK_CONTEXT: Record<Reviewer, string> = {
  alice: "agent-review/alice",
  iris: "agent-review/iris",
};

/** Human-facing reviewer names for pings. */
const REVIEWER_NAME: Record<Reviewer, string> = { alice: "Alice", iris: "Iris" };

/**
 * PR actions we act on. `draft` PRs are skipped regardless (a PR marked
 * ready_for_review re-enters here). Editing/closing/labeling is ignored — a
 * review is keyed to code state (the head SHA), not metadata churn.
 */
export const PR_ACTIONS: readonly string[] = ["opened", "reopened", "ready_for_review", "synchronize"];

/** Default frontend globs (spec System 2 start set). Bridge config may override. */
export const DEFAULT_FRONTEND_PATHS: readonly string[] = ["apps/dashboard/**", "**/*.tsx", "**/*.css"];

export function isActionablePrAction(action: string): boolean {
  return PR_ACTIONS.includes(action);
}

/** Parsed subset of GitHub's native `pull_request` webhook event. */
export interface GithubPrEvent {
  /** opened | reopened | ready_for_review | synchronize | … */
  action: string;
  /** true when the PR is a draft — we never create reviews for drafts. */
  draft: boolean;
  /** "owner/name". */
  repo: string;
  number: number;
  title: string;
  /** PR head commit SHA — reviews are idempotent per (repo, PR, headSha). */
  headSha: string;
  /** PR html_url. */
  url: string;
}

/**
 * Parse GitHub's native `pull_request` event body. Fields live under
 * `pull_request`; `repo` comes from `repository.full_name`. Returns null if it
 * isn't a usable PR event (no repo / number / head sha).
 */
export function parseGithubPrEvent(raw: unknown): GithubPrEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const action = typeof o.action === "string" ? o.action : "";
  const repository = (o.repository ?? {}) as Record<string, unknown>;
  const pr = (o.pull_request ?? {}) as Record<string, unknown>;
  const head = (pr.head ?? {}) as Record<string, unknown>;

  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const rawNumber = pr.number ?? o.number;
  const number = typeof rawNumber === "number" ? rawNumber : Number(rawNumber);
  const title = typeof pr.title === "string" ? pr.title : "";
  const headSha = typeof head.sha === "string" ? head.sha : "";
  if (!repo || !Number.isFinite(number) || number <= 0 || !headSha) return null;

  return {
    action,
    draft: pr.draft === true,
    repo,
    number,
    title,
    headSha,
    url: typeof pr.html_url === "string" ? pr.html_url : "",
  };
}

/** First 7 chars of a SHA for compact display; passes short SHAs through. */
export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/**
 * Decide what to do for one reviewer given the head SHA we last acted on (or null
 * if this reviewer has never seen the PR) and the incoming head SHA. Idempotency
 * is keyed on the head SHA (spec System 2): same SHA → no-op (redelivery), a
 * different SHA → reopen for the new commits.
 */
export type ReviewAction = "create" | "noop" | "reopen";
export function decideReviewAction(priorHeadSha: string | null, newHeadSha: string): ReviewAction {
  if (priorHeadSha === null) return "create";
  return priorHeadSha === newHeadSha ? "noop" : "reopen";
}

/**
 * Compile a path glob to an anchored RegExp. Supports `*` (any run within one
 * path segment), `**` (any run across segments), and `**​/` (zero-or-more
 * leading segments). Enough for the frontendPaths set; not a full minimatch.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++; // consume the second star
        if (glob[i + 1] === "/") {
          i++; // consume the slash — "**​/" matches zero or more leading segments
          re += "(?:.*/)?";
        } else {
          re += ".*"; // trailing/standalone globstar: cross segments
        }
      } else {
        re += "[^/]*"; // single star: within one segment
      }
    } else if (/[.+?^${}()|[\]\\]/.test(c as string)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/**
 * True when any changed file matches any frontend glob (→ Iris also reviews).
 * Case-sensitive: git paths are. Compiles each glob once per call.
 */
export function anyFrontendMatch(files: readonly string[], globs: readonly string[]): boolean {
  const res = globs.map(globToRegExp);
  return files.some((f) => res.some((r) => r.test(f)));
}

/**
 * Loop-prevention / idempotency marker embedded in the review-issue body
 * (spec System 2). MUST stay stable — the worker also derives idempotency from
 * its DB record, but the marker makes the (repo, PR, headSha) provenance visible.
 */
export function prReviewMarker(repo: string, num: number, sha: string): string {
  return `<!-- pr-review: ${repo}#${num}@${sha} -->`;
}

export function buildReviewIssueTitle(reviewer: Reviewer, ev: GithubPrEvent): string {
  const scope = reviewer === "iris" ? " (frontend)" : "";
  return `Review PR ${ev.repo}#${ev.number}${scope} — ${ev.title}`;
}

/**
 * Review-issue body: PR link, head SHA, changed-file summary, a short checklist,
 * and the loop-prevention marker. The reviewing agent signs off by posting the
 * `${CHECK_CONTEXT[reviewer]}` check-run on the head SHA (success), or failure +
 * a PR comment with requested changes.
 */
export function buildReviewIssueBody(
  reviewer: Reviewer,
  ev: GithubPrEvent,
  files: readonly string[],
): string {
  const shown = files.slice(0, 50);
  const fileLines = shown.length
    ? shown.map((f) => `- \`${f}\``).join("\n") + (files.length > shown.length ? `\n- …and ${files.length - shown.length} more` : "")
    : "- _(no files reported)_";
  const context = CHECK_CONTEXT[reviewer];
  return [
    prReviewMarker(ev.repo, ev.number, ev.headSha),
    "",
    `**PR:** ${ev.url || `${ev.repo}#${ev.number}`}`,
    `**Head SHA:** \`${ev.headSha}\``,
    `**Reviewer:** ${REVIEWER_NAME[reviewer]} (\`${context}\`)`,
    "",
    `### Changed files (${files.length})`,
    fileLines,
    "",
    "### Review checklist",
    "- [ ] Correctness — logic, edge cases, error handling",
    reviewer === "iris"
      ? "- [ ] Frontend — accessibility, responsive layout, design-system reuse"
      : "- [ ] Reuse/simplification, tests, security-sensitive changes flagged",
    "- [ ] Sign off: post check-run `" + context + "` on the head SHA (success), or failure + a PR comment with requested changes.",
    "",
    "_Non-required check during Phase 2 soak (GOL-158). Merge gate flips in Phase 3._",
  ].join("\n");
}

/** Comment appended to a review issue when new commits arrive (synchronize). */
export function buildNewCommitsNote(reviewer: Reviewer, ev: GithubPrEvent): string {
  return (
    `🔁 New commits pushed — head is now \`${ev.headSha}\` (${ev.url || `${ev.repo}#${ev.number}`}). ` +
    `Re-review against the new head SHA and re-post the \`${CHECK_CONTEXT[reviewer]}\` check-run (previous sign-off is stale).`
  );
}

// --- Discord state-change pings (spec System 3) ---------------------------------

function reviewerList(reviewers: readonly Reviewer[]): string {
  return reviewers.map((r) => REVIEWER_NAME[r]).join(" + ") || "—";
}

/** 🔍 review issues created for a PR (one ping per PR). */
export function buildReviewIssuesCreatedPing(ev: GithubPrEvent, reviewers: readonly Reviewer[]): string {
  return `🔍 PR ${ev.repo}#${ev.number} → review: ${reviewerList(reviewers)} — <${ev.url || ev.repo}>`;
}

/** 🔁 new commits → re-review reopened for a PR (synchronize). */
export function buildReReviewPing(ev: GithubPrEvent, reviewers: readonly Reviewer[]): string {
  return `🔁 PR ${ev.repo}#${ev.number} new commits (\`${shortSha(ev.headSha)}\`) → re-review: ${reviewerList(reviewers)}`;
}

/** ✅ sign-off green (posted by the reviewing agent's sign-off tooling). */
export function buildSignoffPing(reviewer: Reviewer, repo: string, prNumber: number): string {
  return `✅ PR ${repo}#${prNumber} ${CHECK_CONTEXT[reviewer]} — green`;
}

/** ❌ changes requested (posted by the reviewing agent's sign-off tooling). */
export function buildChangesRequestedPing(reviewer: Reviewer, repo: string, prNumber: number): string {
  return `❌ PR ${repo}#${prNumber} — ${REVIEWER_NAME[reviewer]} requested changes`;
}

/** 🔥 pipeline error (HMAC reject, changed-file fetch fail, check-post fail, API error). */
export function buildPipelineErrorPing(detail: string): string {
  return `🔥 PR review pipeline error: ${detail}`;
}
