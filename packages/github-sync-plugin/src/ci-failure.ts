/**
 * CI → Paperclip fix-issue loop (GOL-305, plugin v0.8.0). Source: approved GOL-303
 * CI/PR audit. Pure, I/O-free logic for the GitHub App `check_suite` /
 * `workflow_run` **completed** webhooks: parse either event into a common shape,
 * classify the aggregate CI state on the PR head SHA (from the commit's check-runs),
 * decide open/update/close/no-op, and build the fix-issue title/body/marker + ops
 * pings. The worker wires this to GitHub + Paperclip I/O.
 *
 * WHY event-as-trigger, state-from-check-runs: `check_suite` and `workflow_run`
 * completions are near-duplicate signals (one workflow_run rolls up into the same
 * check_suite), and a single `workflow_run: success` does NOT mean the whole suite
 * is green. So we treat the event only as a trigger to re-derive the ground-truth
 * CI state from the head SHA's check-runs (`GET /commits/{sha}/check-runs`). Both
 * event types then converge on one code path and can't disagree.
 *
 * The agent PR review sign-off checks (`agent-review/*`, pr-signoff.ts) are
 * EXCLUDED from the CI state — this loop is about real CI (GitHub Actions) failing,
 * not the review gate, and a pending review check must never look like "CI red" nor
 * block the green auto-close.
 */

/** GitHub login that authors every agent PR (the shared Developer App identity). */
export const DEFAULT_AGENT_PR_AUTHOR = "agenticos-developer[bot]";

/** Prefix of the plugin's own review sign-off checks — excluded from CI state. */
export const AGENT_REVIEW_CHECK_PREFIX = "agent-review/";

/** check-run conclusions that count as a red/failing CI check. */
export const FAILING_CONCLUSIONS: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

/** check-run conclusions that are non-failing terminal states. */
export const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "neutral", "skipped"]);

/** One check-run on a commit, reduced to what CI classification + display need. */
export interface CheckRunSummary {
  name: string;
  /** queued | in_progress | completed */
  status: string;
  /** success | failure | timed_out | … | null (null while not completed) */
  conclusion: string | null;
  detailsUrl?: string;
  /** Short excerpt from the check-run's output (title/summary) for the fix issue. */
  summary?: string;
}

/** Common parse of a `check_suite` / `workflow_run` completed webhook. */
export interface CiCompletionEvent {
  kind: "check_suite" | "workflow_run";
  /** GitHub webhook action — we only act on "completed". */
  action: string;
  /** "owner/name". */
  repo: string;
  /** The commit the run executed against (== PR head SHA for same-repo PRs). */
  headSha: string;
  /** The event's own conclusion (advisory only — CI state is re-derived). */
  conclusion: string | null;
  /** PR numbers this run is associated with (same-repo PRs; empty for forks/pushes). */
  prNumbers: number[];
  /** Human label for the run (workflow name / app name) — display only. */
  name: string;
  /** Link to the run/suite for the fix issue, when the event carried one. */
  detailsUrl: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function prNumbersFrom(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const pr of raw) {
    const n = Number(asRecord(pr).number);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  // Distinct, stable order.
  return [...new Set(out)];
}

/** Parse a `check_suite` webhook body. Returns null if it isn't usable. */
export function parseCheckSuiteEvent(raw: unknown): CiCompletionEvent | null {
  const o = asRecord(raw);
  const cs = asRecord(o.check_suite);
  const repository = asRecord(o.repository);
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const headSha = typeof cs.head_sha === "string" ? cs.head_sha : "";
  if (!repo || !headSha) return null;
  const app = asRecord(cs.app);
  return {
    kind: "check_suite",
    action: typeof o.action === "string" ? o.action : "",
    repo,
    headSha,
    conclusion: typeof cs.conclusion === "string" ? cs.conclusion : null,
    prNumbers: prNumbersFrom(cs.pull_requests),
    name: typeof app.name === "string" && app.name ? app.name : "CI",
    detailsUrl: "",
  };
}

/** Parse a `workflow_run` webhook body. Returns null if it isn't usable. */
export function parseWorkflowRunEvent(raw: unknown): CiCompletionEvent | null {
  const o = asRecord(raw);
  const wr = asRecord(o.workflow_run);
  const repository = asRecord(o.repository);
  const repo = typeof repository.full_name === "string" ? repository.full_name : "";
  const headSha = typeof wr.head_sha === "string" ? wr.head_sha : "";
  if (!repo || !headSha) return null;
  return {
    kind: "workflow_run",
    action: typeof o.action === "string" ? o.action : "",
    repo,
    headSha,
    conclusion: typeof wr.conclusion === "string" ? wr.conclusion : null,
    prNumbers: prNumbersFrom(wr.pull_requests),
    name: typeof wr.name === "string" && wr.name ? wr.name : "workflow",
    detailsUrl: typeof wr.html_url === "string" ? wr.html_url : "",
  };
}

/** Dispatch on the GitHub X-GitHub-Event header. */
export function parseCiCompletionEvent(raw: unknown, eventType: string): CiCompletionEvent | null {
  if (eventType === "check_suite") return parseCheckSuiteEvent(raw);
  if (eventType === "workflow_run") return parseWorkflowRunEvent(raw);
  return null;
}

/** True for the plugin's own review sign-off checks (not real CI). */
export function isAgentReviewCheck(name: string): boolean {
  return name.startsWith(AGENT_REVIEW_CHECK_PREFIX);
}

/** True when a completed check-run's conclusion is a failing state. */
export function isFailingCheck(c: CheckRunSummary): boolean {
  return c.conclusion !== null && FAILING_CONCLUSIONS.has(c.conclusion);
}

/**
 * Aggregate CI state on a head SHA, ignoring the plugin's own `agent-review/*`
 * checks:
 *   - "failing" — at least one real CI check has a failing conclusion.
 *   - "green"   — real CI checks exist, all completed, none failing.
 *   - "pending" — real CI checks exist but some are still queued/in_progress and
 *                 none have failed yet.
 *   - "none"    — no real CI checks reported for this SHA (nothing to act on).
 * Red beats pending (a red check routes immediately, even while others run); green
 * requires everything settled non-failing (so auto-close never fires early).
 */
export type CiState = "failing" | "green" | "pending" | "none";

/** The real-CI subset used for classification (excludes `agent-review/*`). */
export function ciChecks(checks: readonly CheckRunSummary[]): CheckRunSummary[] {
  return checks.filter((c) => !isAgentReviewCheck(c.name));
}

/** The failing real-CI checks — the "failed job list" embedded in the fix issue. */
export function failingChecks(checks: readonly CheckRunSummary[]): CheckRunSummary[] {
  return ciChecks(checks).filter(isFailingCheck);
}

export function classifyCiState(checks: readonly CheckRunSummary[]): CiState {
  const ci = ciChecks(checks);
  if (ci.length === 0) return "none";
  if (ci.some(isFailingCheck)) return "failing";
  if (ci.some((c) => c.status !== "completed")) return "pending";
  return "green";
}

/**
 * Decide what to do for the (repo, PR#) given its current fix-issue record and the
 * freshly-classified CI state. Pure — the worker performs the matching I/O.
 *   - failing → update an open issue in place, else create a new one.
 *   - green   → close an open issue, else no-op.
 *   - pending/none → no-op (wait for a terminal signal).
 */
export type CiFixAction = "create" | "update" | "close" | "noop";
export function decideCiFixAction(
  record: { status: "open" | "closed" } | null,
  state: CiState,
): CiFixAction {
  if (state === "failing") return record && record.status === "open" ? "update" : "create";
  if (state === "green") return record && record.status === "open" ? "close" : "noop";
  return "noop";
}

// --- Fix-issue rendering ---------------------------------------------------------

/**
 * Loop-prevention / idempotency marker embedded in the fix-issue body. One fix
 * issue per (repo, PR#); the store row is the source of truth, but the marker keeps
 * the provenance visible and lets a human/tool find the issue for a PR.
 */
export function ciFixMarker(repo: string, prNumber: number): string {
  return `<!-- ci-fix: ${repo}#${prNumber} -->`;
}

/** First 7 chars of a SHA for compact display; passes short SHAs through. */
export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Render the failed-check list (name + one-line excerpt) for the issue body. */
export function renderFailedChecks(failed: readonly CheckRunSummary[]): string {
  if (failed.length === 0) return "- _(no individual failing check reported)_";
  const shown = failed.slice(0, 20);
  const lines = shown.map((c) => {
    const excerpt = c.summary ? ` — ${truncate(c.summary.replace(/\s+/g, " "), 160)}` : "";
    const link = c.detailsUrl ? ` ([logs](${c.detailsUrl}))` : "";
    return `- \`${c.name}\`${excerpt}${link}`;
  });
  if (failed.length > shown.length) lines.push(`- …and ${failed.length - shown.length} more`);
  return lines.join("\n");
}

export interface CiFixContext {
  repo: string;
  prNumber: number;
  prUrl: string;
  prTitle: string;
  headSha: string;
  ownerName: string;
  runName: string;
  runUrl: string;
  failed: readonly CheckRunSummary[];
}

export function buildCiFixTitle(ctx: Pick<CiFixContext, "repo" | "prNumber" | "prTitle">): string {
  const suffix = ctx.prTitle ? ` — ${ctx.prTitle}` : "";
  return `CI failing — ${ctx.repo}#${ctx.prNumber}${suffix}`;
}

/**
 * Fix-issue body: the loop marker, the PR/run links, the head SHA, the owner, the
 * failed-check list with log excerpts, and how the issue resolves (push a fix → CI
 * green → this issue auto-closes; abandon → close it `done` yourself).
 */
export function buildCiFixBody(ctx: CiFixContext): string {
  const runLine = ctx.runUrl ? `${ctx.runName} (${ctx.runUrl})` : ctx.runName;
  return [
    ciFixMarker(ctx.repo, ctx.prNumber),
    "",
    `**PR:** ${ctx.prUrl || `${ctx.repo}#${ctx.prNumber}`}`,
    `**Head SHA:** \`${ctx.headSha}\``,
    `**Failing run:** ${runLine}`,
    `**Owner:** ${ctx.ownerName}`,
    "",
    `### Failing checks (${ctx.failed.length})`,
    renderFailedChecks(ctx.failed),
    "",
    "### What to do",
    "- Reproduce + fix the failure, then push to the PR branch.",
    "- When CI goes green on the new head SHA this issue **auto-closes** (GOL-305).",
    "- If the PR is being abandoned, close this issue `done` — a green suite would do the same.",
    "",
    "_Opened automatically from a failing CI check on an agent-authored PR (GOL-305)._",
  ].join("\n");
}

/** Comment appended to an open fix issue when CI fails again (new head / re-run). */
export function buildCiReFailNote(ctx: Pick<CiFixContext, "headSha" | "runName" | "failed">): string {
  return [
    `🔁 CI still failing at head \`${shortSha(ctx.headSha)}\` (${ctx.runName}).`,
    "",
    `### Failing checks (${ctx.failed.length})`,
    renderFailedChecks(ctx.failed),
  ].join("\n");
}

/** Comment appended when the suite goes green and the issue auto-closes. */
export function buildCiResolvedNote(headSha: string): string {
  return `✅ CI is green at head \`${shortSha(headSha)}\` — auto-closing this fix issue (GOL-305).`;
}

// --- Discord state-change pings --------------------------------------------------

export function buildCiFixOpenedPing(ctx: Pick<CiFixContext, "repo" | "prNumber" | "ownerName" | "prUrl">): string {
  return `🚨 CI failing on ${ctx.repo}#${ctx.prNumber} → fix issue for ${ctx.ownerName} — <${ctx.prUrl || ctx.repo}>`;
}

export function buildCiFixUpdatedPing(ctx: Pick<CiFixContext, "repo" | "prNumber" | "headSha">): string {
  return `🔁 CI still failing on ${ctx.repo}#${ctx.prNumber} (\`${shortSha(ctx.headSha)}\`) → fix issue updated`;
}

export function buildCiFixResolvedPing(repo: string, prNumber: number): string {
  return `✅ CI green on ${repo}#${prNumber} → fix issue auto-closed`;
}
