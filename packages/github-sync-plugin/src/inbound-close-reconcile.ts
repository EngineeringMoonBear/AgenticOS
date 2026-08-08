/**
 * Inbound-close reconcile sweep (GOL-1206) — the polling mirror of the
 * event-driven closure propagation (`handleAppClosure`, worker.ts).
 *
 * Closure propagation (GitHub close → Paperclip mirror `done`) is verified live
 * on AgenticOS, where the GitHub App delivers the `issues` `closed`/`reopened`
 * event. But the **Goldberry-Playground** org (grove-sites, odoocker-goldberrygrove,
 * grove-odoo-modules) is NOT an App installation target, so no `issues` event ever
 * reaches the worker for those repos (root-caused at worker.ts, GOL-1159/GOL-289).
 * A merged `Closes #N` PR closes the GitHub twin, but nothing brings that close
 * back into Paperclip — the existing `mirror-reconcile` sweep is outbound-only
 * (Paperclip → GitHub) and skips terminal issues.
 *
 * This hourly sweep is the event-independent inbound leg. For each bridged repo it
 * lists recently-updated GitHub issues (PRs already filtered out by the client) and
 * re-drives the SAME `handleAppClosure` code path the App webhook uses, deriving the
 * action from the issue's GitHub state (`closed` → maybe-`done`, `open` → maybe
 * reopen). Because it reuses that one handler, it inherits — verbatim, no
 * duplication:
 *   - the mapping lookup (`getByRepoNumber`): an unmapped issue is ignored;
 *   - the `resolveMirrorClosureStatus` status matrix: a mirror already in the
 *     target state returns null → skipped with the SAME
 *     "mirror already in sync; skipping (loop guard)" log — so the outbound-close
 *     echo (Paperclip closes → twin closed → sweep sees closed → mirror already
 *     `done`) is a no-op and never bounces;
 *   - the REST-fallback write path (scope-expiry safe — a cron tick has no ambient
 *     invocation scope, same hazard the mirror-reconcile sweep hit in GOL-1163).
 *
 * AgenticOS keeps working event-driven and stays a no-op here (its closes reach the
 * mirror before the sweep runs, so the loop guard skips them). Idempotent and safe
 * to run every cycle: re-scanning a settled repo only produces loop-guard skips.
 */
import type { SyncLogger } from "./sync.js";

/** Minimal issue shape the sweep needs — number + GitHub state. PRs are already
 *  filtered out upstream (GitHubClient.listIssues drops `pull_request` items). */
export interface InboundIssueRef {
  number: number;
  state: "open" | "closed";
}

/** Result of listing one repo's recent issues; `{ ok:false }` is a transient
 *  read failure (auth blip / timeout) that the next sweep retries. */
export type ListIssuesResult =
  | { ok: true; issues: InboundIssueRef[]; truncated: boolean }
  | { ok: false; error: string };

/** Outcome of a single closure re-drive — the return of `handleAppClosure`. */
export type ClosureDriveOutcome =
  | "no-bridge"
  | "no-company"
  | "unmapped"
  | "unreadable"
  | "pruned"
  | "in-sync"
  | "propagated";

export interface InboundCloseReconcileInput {
  /** Full `owner/repo` slugs to sweep — the bridged Goldberry-Playground repos.
   *  matchBridge + getByRepoNumber normalise the slug, so the full form is safe. */
  repoSlugs: readonly string[];
  /** List a repo's recently-updated issues (PRs pre-filtered, capped, `since`-bounded). */
  listIssues: (repoSlug: string) => Promise<ListIssuesResult>;
  /**
   * Re-drive the SAME closure propagation the App webhook uses for one issue.
   * `action` is derived from the issue's GitHub state (closed → "closed",
   * open → "reopened"); the handler's `resolveMirrorClosureStatus` decides whether
   * that actually changes the mirror, so passing "reopened" for a never-terminal
   * mirror is a cheap loop-guard skip, not a bounce.
   */
  driveClosure: (drive: {
    action: "closed" | "reopened";
    repoSlug: string;
    number: number;
  }) => Promise<ClosureDriveOutcome>;
  logger: SyncLogger;
}

export interface InboundCloseReconcileSummary {
  /** GitHub issues examined across all repos (post-PR-filter). */
  scanned: number;
  /** Mirrors whose status was written (closed → done, or reopen). */
  propagated: number;
  /** Closed/updated issue with no Paperclip twin — ignored. */
  skippedUnmapped: number;
  /** Mirror already in the target state — the loop guard. */
  skippedInSync: number;
  /**
   * Orphaned mappings self-healed this run: the mirror was confirmed permanently
   * gone (twin hard-deleted → not-found on both the in-scope read and the REST
   * fallback), so the stale row was pruned instead of retried forever (GOL-1274).
   * A cleanup, NOT a failure — deliberately kept out of `failed` so it does not
   * page ops every hour.
   */
  pruned: number;
  /** Per-issue re-drive failures that ARE actionable (transient unreadable /
   *  write error) — next sweep retries. Excludes permanent-deletion prunes. */
  failed: number;
  /** Repos whose issue-list call failed outright — next sweep retries. */
  reposFailed: number;
  /** Any repo hit the page cap (its older issues were not scanned this run). */
  truncated: boolean;
}

export async function runInboundCloseReconcile(
  input: InboundCloseReconcileInput,
): Promise<InboundCloseReconcileSummary> {
  const summary: InboundCloseReconcileSummary = {
    scanned: 0,
    propagated: 0,
    skippedUnmapped: 0,
    skippedInSync: 0,
    pruned: 0,
    failed: 0,
    reposFailed: 0,
    truncated: false,
  };

  for (const repoSlug of input.repoSlugs) {
    const listed = await input.listIssues(repoSlug);
    if (!listed.ok) {
      summary.reposFailed++;
      input.logger.warn("inbound-close-reconcile: issue list failed; skipping repo this run", {
        repo: repoSlug,
        error: listed.error,
      });
      continue;
    }
    if (listed.truncated) summary.truncated = true;

    for (const issue of listed.issues) {
      summary.scanned++;
      const action: "closed" | "reopened" = issue.state === "closed" ? "closed" : "reopened";
      try {
        const outcome = await input.driveClosure({ action, repoSlug, number: issue.number });
        switch (outcome) {
          case "propagated":
            summary.propagated++;
            break;
          case "in-sync":
            summary.skippedInSync++;
            break;
          case "unmapped":
          case "no-bridge":
            // Not a mirrored issue (or the repo dropped out of config mid-run) — nothing to do.
            summary.skippedUnmapped++;
            break;
          case "pruned":
            // Mirror confirmed permanently gone; the orphaned mapping was pruned.
            // A cleanup, not a failure — next sweep sees the twin as unmapped (GOL-1274).
            summary.pruned++;
            break;
          case "unreadable":
          case "no-company":
            // Transient: mirror unreadable, or companyId lost mid-run — retry next sweep.
            summary.failed++;
            break;
        }
      } catch (err) {
        summary.failed++;
        input.logger.warn("inbound-close-reconcile: closure re-drive failed; continuing sweep", {
          repo: repoSlug,
          number: issue.number,
          action,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return summary;
}

/** Ops-channel one-liner for a sweep that changed something. `pruned` is surfaced
 *  as an observable cleanup, distinct from `failed` (which stays actionable). */
export function buildInboundCloseReconcilePing(s: InboundCloseReconcileSummary): string {
  return `🔁 inbound-close-reconcile: propagated ${s.propagated} GitHub close(s) → Paperclip, pruned ${s.pruned} orphaned mapping(s), ${s.failed} failed (scanned ${s.scanned})`;
}
