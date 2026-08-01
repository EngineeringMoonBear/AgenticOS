/**
 * Mirror reconcile sweep (scheduled job `mirror-reconcile`).
 *
 * The outbound mirror is purely event-driven: an issue only gets a GitHub twin
 * if its `issue.created` event was delivered AND the handler survived (no
 * scope-expiry, no http.fetch timeout, bridge already configured). Issues
 * created BEFORE a bridge was applied, or during a drop window, are never
 * revisited — ~78 active issues across the three bridged projects had no twin
 * when this shipped. This sweep is the missing feedback loop: every run lists
 * the bridged projects' issues and mirrors any active, unmapped, non-operational
 * issue through the same handleIssueCreated path the event uses (idempotent —
 * it re-checks the mapping and honours the inbound `synced-from-github` marker,
 * so GitHub-originated issues get a provenance row, not a bounce-back).
 *
 * Guard rails:
 *  - `maxCreates` per run (default 20) so a first run over a large backlog
 *    trickles out instead of bursting GitHub rate limits / notification spam.
 *  - Terminal issues (done/cancelled) are skipped — history stays in Paperclip;
 *    mirroring closed work would only create pre-closed GitHub noise.
 *  - Plugin-operational issues (pr-review/ci-fix markers) are skipped, matching
 *    the event-path guard in handleIssueCreated.
 *  - Per-issue failures are counted and logged, never thrown — one bad issue
 *    can't kill the sweep.
 */
import type { Issue } from "@paperclipai/plugin-sdk";
import { handleIssueCreated, isPluginOperationalIssue, isTerminalStatus, type SyncDeps, type SyncLogger } from "./sync.js";
import { getByPaperclipId } from "./mapping.js";

export interface ReconcileInput {
  companyId: string;
  /** Distinct bridged project ids (depsByProject keys). */
  projectIds: readonly string[];
  /** Page through a project's issues. Backed by ctx.issues.list. */
  listIssues: (projectId: string, offset: number, limit: number) => Promise<Issue[]>;
  /** The same per-project SyncDeps the event dispatch uses. */
  depsForProject: (projectId: string) => SyncDeps | undefined;
  logger: SyncLogger;
  /** Create budget per run; a capped run reports `capped: true` and the next run continues. */
  maxCreates?: number;
}

export interface ReconcileSummary {
  scanned: number;
  created: number;
  skippedMapped: number;
  skippedTerminal: number;
  skippedPluginOp: number;
  failed: number;
  capped: boolean;
}

const PAGE_SIZE = 100;
const DEFAULT_MAX_CREATES = 20;

export async function runMirrorReconcile(input: ReconcileInput): Promise<ReconcileSummary> {
  const maxCreates = input.maxCreates ?? DEFAULT_MAX_CREATES;
  const summary: ReconcileSummary = {
    scanned: 0,
    created: 0,
    skippedMapped: 0,
    skippedTerminal: 0,
    skippedPluginOp: 0,
    failed: 0,
    capped: false,
  };

  for (const projectId of input.projectIds) {
    const deps = input.depsForProject(projectId);
    if (!deps) continue; // bridge skipped at setup (no auth) — nothing to mirror into

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await input.listIssues(projectId, offset, PAGE_SIZE);
      for (const issue of page) {
        summary.scanned++;
        if (isTerminalStatus(issue.status)) {
          summary.skippedTerminal++;
          continue;
        }
        if (isPluginOperationalIssue(issue.description)) {
          summary.skippedPluginOp++;
          continue;
        }
        if (await getByPaperclipId(deps.db, issue.id)) {
          summary.skippedMapped++;
          continue;
        }
        // Budget ATTEMPTS (not successes) so a failing GitHub API is retried at
        // next run's pace instead of hammered for the whole backlog in one sweep.
        if (summary.created + summary.failed >= maxCreates) {
          summary.capped = true;
          return summary;
        }
        try {
          // Same idempotent path as the issue.created event; records the mapping.
          await handleIssueCreated(deps, { issueId: issue.id, companyId: input.companyId });
          // handleIssueCreated logs-and-returns on GitHub failure rather than
          // throwing — the mapping row is the ground truth for success.
          if (await getByPaperclipId(deps.db, issue.id)) {
            summary.created++;
          } else {
            summary.failed++;
          }
        } catch (err) {
          summary.failed++;
          input.logger.error("mirror-reconcile: mirror-create failed; continuing sweep", {
            issueId: issue.id,
            projectId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return summary;
}

/** Ops-channel one-liner for a sweep that did something noteworthy. */
export function buildReconcilePing(s: ReconcileSummary): string {
  const capNote = s.capped ? " — capped, next run continues" : "";
  return `🧹 mirror-reconcile: created ${s.created} missing GitHub twin(s), ${s.failed} failed (scanned ${s.scanned})${capNote}`;
}
