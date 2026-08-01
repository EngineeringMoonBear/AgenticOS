import type { Issue } from "@paperclipai/plugin-sdk";
import type { GitHubClient, UpdateIssueInput } from "./github-client.js";
import {
  getByPaperclipId,
  upsert,
  type MappingDb,
  type MappingRow,
} from "./mapping.js";

/** Resolved config the sync logic needs. */
export interface SyncConfig {
  githubRepo: string;
  syncLabelPaperclip: string;
  syncMarkerGithub: string;
}

/** Minimal logger surface (subset of ctx.logger) so sync is testable. */
export interface SyncLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const GITHUB_MARKER_RE = /<!--\s*synced-from-github:\s*([^\s#]+)#(\d+)\s*-->/i;

/**
 * Markers stamped into issues this plugin CREATES for its own pipelines —
 * PR-review issues (prReviewMarker) and CI fix issues (ciFixMarker). Those are
 * operational artifacts about GitHub state, not work items: mirroring them back
 * out as GitHub issues is pure noise (202 junk "Review PR …" issues had
 * accumulated in bridged repos before this guard existed). Both the
 * issue.created event path and the reconcile sweep skip them.
 */
const PLUGIN_OPERATIONAL_MARKER_RE = /<!--\s*(pr-review|ci-fix):/i;

/** True when the issue is one of this plugin's own operational issues. */
export function isPluginOperationalIssue(description: string | null | undefined): boolean {
  return !!description && PLUGIN_OPERATIONAL_MARKER_RE.test(description);
}

/** Map a Paperclip issue status to a GitHub issue state. */
export function statusToGithubState(status: Issue["status"]): "open" | "closed" {
  return status === "done" || status === "cancelled" ? "closed" : "open";
}

/** A Paperclip status is "closed" from GitHub's point of view when terminal. */
export function isTerminalStatus(status: Issue["status"]): boolean {
  return status === "done" || status === "cancelled";
}

/**
 * Inbound closure propagation (GitHub → Paperclip). Given a GitHub `issues`
 * action and the mirror's CURRENT Paperclip status, decide the status to write —
 * or `null` when no change is needed.
 *
 * - `closed`   → `done`, unless the mirror is already terminal.
 * - `reopened` → `todo`, only when the mirror is currently terminal.
 * - anything else → `null` (not a state-changing action).
 *
 * Returning `null` when the mirror already matches is the loop guard. An outbound
 * close (Paperclip → GitHub) echoes back as a GitHub `closed` App-webhook event;
 * finding the mirror already `done`, we make no update, so no `issue.updated`
 * fires and the two sides settle in one cycle with no bounce. This is the same
 * marker/mapping-based idempotency the outbound leg relies on, applied inbound.
 */
export function resolveMirrorClosureStatus(
  action: string,
  currentStatus: Issue["status"],
): Issue["status"] | null {
  if (action === "closed") return isTerminalStatus(currentStatus) ? null : "done";
  if (action === "reopened") return isTerminalStatus(currentStatus) ? "todo" : null;
  return null;
}

/**
 * Detect the inbound (GitHub → Paperclip) marker an inbound routine embeds in a
 * native Paperclip issue's description: `<!-- synced-from-github: <repo>#<number> -->`.
 * Returns the parsed repo+number, or null if absent.
 */
export function detectGithubMarker(
  description: string | null | undefined,
): { repo: string; number: number } | null {
  if (!description) return null;
  const m = GITHUB_MARKER_RE.exec(description);
  if (!m) return null;
  return { repo: m[1]!, number: Number(m[2]) };
}

/** HTML-comment marker stamped into GitHub issue bodies created from Paperclip. */
export function paperclipMarker(paperclipIssueId: string): string {
  return `<!-- synced-from-paperclip: ${paperclipIssueId} -->`;
}

/** Build the GitHub issue body for a native Paperclip issue. */
export function buildGithubBody(issue: Issue): string {
  const description = issue.description ?? "";
  const ref = issue.identifier ? `Paperclip issue ${issue.identifier}` : `Paperclip issue ${issue.id}`;
  const footer = `\n\n---\n_Synced from ${ref}._\n${paperclipMarker(issue.id)}`;
  return `${description}${footer}`;
}

export interface SyncDeps {
  db: MappingDb;
  github: GitHubClient;
  config: SyncConfig;
  logger: SyncLogger;
  /** Reads the full issue back (delta event payloads omit description). */
  getIssue: (issueId: string, companyId: string) => Promise<Issue | null>;
  /**
   * Best-effort ops-channel ping (Discord). Optional — the mirror-sync path
   * doesn't use it; the PR sign-off path (GOL-186) pings on green / API failure.
   */
  postOpsPing?: (content: string) => Promise<void>;
  /**
   * Resolve a full `owner/repo` slug (as stored on github_pr_review rows) to that
   * bridge's client + bare repo name. The sign-off completion path must use THIS,
   * not `github`/`config` above: deps are keyed by paperclipProjectId, and when two
   * bridges share one project those fields belong to whichever bridge registered
   * last — completions then land on the wrong repo ("No commit found for SHA",
   * grove-odoo-modules PRs #44/#46). Optional so pure-sync callers/tests need not
   * wire it; without it the sign-off path falls back to `github` + the slug's bare
   * repo name.
   */
  resolveRepoClient?: (repoSlug: string) => { github: GitHubClient; repo: string } | null;
}

/**
 * Handle an `issue.created` domain event. Loop-prevention rules:
 *
 * - Already mapped → already synced, do nothing.
 * - Description carries the GitHub marker → it came FROM GitHub (inbound routine):
 *   record the mapping with origin "github" and DO NOT create a GitHub issue.
 * - Otherwise (native Paperclip issue) → create a GitHub issue, stamp it with the
 *   paperclip label + back-link footer + marker, and record the mapping (origin "paperclip").
 */
export async function handleIssueCreated(
  deps: SyncDeps,
  input: { issueId: string; companyId: string },
): Promise<void> {
  const { db, github, config, logger, getIssue } = deps;

  const existing = await getByPaperclipId(db, input.issueId);
  if (existing) {
    logger.info("issue.created already mapped; skipping", { issueId: input.issueId });
    return;
  }

  const issue = await getIssue(input.issueId, input.companyId);
  if (!issue) {
    logger.warn("issue.created: issue not readable; skipping", { issueId: input.issueId });
    return;
  }

  if (isPluginOperationalIssue(issue.description)) {
    logger.info("issue.created is a plugin-operational issue (pr-review/ci-fix); not mirrored", {
      issueId: issue.id,
    });
    return;
  }

  const marker = detectGithubMarker(issue.description);
  if (marker) {
    // Inbound (GitHub-originated) issue — record provenance, never push back out.
    await upsert(db, {
      paperclipIssueId: issue.id,
      githubRepo: marker.repo,
      githubIssueNumber: marker.number,
      lastSyncedAt: new Date().toISOString(),
      origin: "github",
    });
    logger.info("issue.created originated from GitHub; recorded mapping, no outbound", {
      issueId: issue.id,
      githubRepo: marker.repo,
      githubIssueNumber: marker.number,
    });
    return;
  }

  // Native Paperclip issue → create the GitHub mirror.
  const created = await github.createIssue(config.githubRepo, {
    title: issue.title,
    body: buildGithubBody(issue),
    labels: [config.syncLabelPaperclip],
  });
  if (!created.ok) {
    logger.error("issue.created: failed to create GitHub issue", {
      issueId: issue.id,
      error: created.error,
    });
    return;
  }

  await upsert(db, {
    paperclipIssueId: issue.id,
    githubRepo: config.githubRepo,
    githubIssueNumber: created.data.number,
    lastSyncedAt: new Date().toISOString(),
    origin: "paperclip",
  });
  logger.info("issue.created mirrored to GitHub", {
    issueId: issue.id,
    githubRepo: config.githubRepo,
    githubIssueNumber: created.data.number,
  });
}

/**
 * Handle an `issue.updated` domain event. If the issue is mapped, push the
 * current title/body/state to GitHub and bump last_synced_at. Unmapped → ignore.
 */
export async function handleIssueUpdated(
  deps: SyncDeps,
  input: { issueId: string; companyId: string },
): Promise<void> {
  const { db, github, config, logger, getIssue } = deps;

  const mapping = await getByPaperclipId(db, input.issueId);
  if (!mapping) {
    logger.info("issue.updated: not mapped; ignoring", { issueId: input.issueId });
    return;
  }

  const issue = await getIssue(input.issueId, input.companyId);
  if (!issue) {
    logger.warn("issue.updated: issue not readable; skipping", { issueId: input.issueId });
    return;
  }

  const fullPatch: UpdateIssueInput = {
    title: issue.title,
    body: buildGithubBody(issue),
    state: statusToGithubState(issue.status),
  };
  let updated = await github.updateIssue(
    mapping.githubRepo,
    mapping.githubIssueNumber,
    fullPatch,
  );

  // Partial-field 422 sanitizing (GOL-793). GitHub sometimes rejects a single
  // sub-field of the mirror push (e.g. a `state` transition it won't allow on a
  // PR-backed mapping) with a 422 whose errors[] names the offending field. When
  // it does, drop exactly the field(s) GitHub flagged and retry once so the rest
  // of the mirror (title/body) still lands instead of the whole update failing.
  if (
    !updated.ok &&
    updated.status === 422 &&
    updated.errors?.some((e) => e.field)
  ) {
    const rejected = new Set(
      updated.errors.map((e) => e.field).filter((f): f is string => Boolean(f)),
    );
    const sanitized: UpdateIssueInput = {};
    if (!rejected.has("title")) sanitized.title = fullPatch.title;
    if (!rejected.has("body")) sanitized.body = fullPatch.body;
    if (!rejected.has("state")) sanitized.state = fullPatch.state;
    if (Object.keys(sanitized).length > 0) {
      logger.warn("issue.updated: GitHub rejected field(s); retrying sanitized payload", {
        issueId: issue.id,
        githubRepo: mapping.githubRepo,
        githubIssueNumber: mapping.githubIssueNumber,
        rejectedFields: [...rejected],
        githubErrors: updated.errors,
      });
      updated = await github.updateIssue(
        mapping.githubRepo,
        mapping.githubIssueNumber,
        sanitized,
      );
    }
  }

  if (!updated.ok) {
    logger.error("issue.updated: failed to update GitHub issue", {
      issueId: issue.id,
      githubRepo: mapping.githubRepo,
      githubIssueNumber: mapping.githubIssueNumber,
      error: updated.error,
      githubStatus: updated.status,
      githubErrors: updated.errors,
    });
    return;
  }

  const next: MappingRow = { ...mapping, lastSyncedAt: new Date().toISOString() };
  await upsert(db, next);
  logger.info("issue.updated pushed to GitHub", {
    issueId: issue.id,
    githubRepo: mapping.githubRepo,
    githubIssueNumber: mapping.githubIssueNumber,
    state: statusToGithubState(issue.status),
  });
}
