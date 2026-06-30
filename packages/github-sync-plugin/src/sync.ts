import type { Issue } from "@paperclipai/plugin-sdk";
import type { GitHubClient } from "./github-client.js";
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

/** Map a Paperclip issue status to a GitHub issue state. */
export function statusToGithubState(status: Issue["status"]): "open" | "closed" {
  return status === "done" || status === "cancelled" ? "closed" : "open";
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

  const updated = await github.updateIssue(mapping.githubRepo, mapping.githubIssueNumber, {
    title: issue.title,
    body: buildGithubBody(issue),
    state: statusToGithubState(issue.status),
  });
  if (!updated.ok) {
    logger.error("issue.updated: failed to update GitHub issue", {
      issueId: issue.id,
      githubRepo: mapping.githubRepo,
      githubIssueNumber: mapping.githubIssueNumber,
      error: updated.error,
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
