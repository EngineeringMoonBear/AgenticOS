import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { ensureMappingTable } from "./mapping.js";
import {
  handleIssueCreated,
  handleIssueUpdated,
  type SyncConfig,
  type SyncDeps,
} from "./sync.js";

interface GithubSyncConfig extends SyncConfig {
  githubToken: string;
  githubOrg: string;
  /** Only issues in this project are mirrored; subscriptions are filtered to it. */
  paperclipProjectId: string;
}

function readConfig(raw: Record<string, unknown>): GithubSyncConfig {
  return {
    githubToken: String(raw.githubToken ?? ""),
    githubOrg: String(raw.githubOrg ?? "EngineeringMoonBear"),
    githubRepo: String(raw.githubRepo ?? ""),
    paperclipProjectId: String(raw.paperclipProjectId ?? ""),
    syncLabelPaperclip: String(raw.syncLabelPaperclip ?? "synced-from-paperclip"),
    syncMarkerGithub: String(raw.syncMarkerGithub ?? "synced-from-github"),
  };
}

/**
 * Assemble the sync dependencies from the current plugin config, read at call
 * time so config edits take effect without a worker restart.
 */
async function buildDeps(ctx: PluginContext): Promise<SyncDeps> {
  const cfg = readConfig(await ctx.config.get());
  if (!cfg.githubToken) {
    throw new Error("GitHub token not configured — set it in the plugin settings");
  }
  if (!cfg.githubRepo) {
    throw new Error("GitHub repo not configured — set it in the plugin settings");
  }
  const github = new GitHubClient({
    token: cfg.githubToken,
    org: cfg.githubOrg,
    timeoutMs: 8000,
  });
  return {
    db: ctx.db,
    github,
    config: cfg,
    logger: ctx.logger,
    getIssue: (issueId, companyId) => ctx.issues.get(issueId, companyId),
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Sync plugin starting");

    // Idempotent DDL on start so the mapping table exists before the first event.
    await ensureMappingTable(ctx.db);

    // Scope to ONE project. Subscribing company-wide would mirror unrelated work
    // (QA-triage issues, every agent task) into GitHub — and could double up with
    // issues GitHub Actions already opened — so refuse to run unscoped.
    const projectId = readConfig(await ctx.config.get()).paperclipProjectId;
    if (!projectId) {
      ctx.logger.warn(
        "paperclipProjectId not configured — GitHub Sync is INACTIVE (refusing to mirror company-wide). Set it in plugin settings.",
      );
      return;
    }
    const projectFilter = { projectId };

    // --- Paperclip → GitHub mirroring (event-driven, scoped to the project) ---

    ctx.events.on("issue.created", projectFilter, async (event: PluginEvent) => {
      // Per-event error isolation — a handler must never throw back to the bus.
      try {
        if (!event.entityId) {
          ctx.logger.warn("issue.created event missing entityId; skipping");
          return;
        }
        const deps = await buildDeps(ctx);
        await handleIssueCreated(deps, {
          issueId: event.entityId,
          companyId: event.companyId,
        });
      } catch (err) {
        ctx.logger.error("issue.created handler failed", {
          issueId: event.entityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ctx.events.on("issue.updated", projectFilter, async (event: PluginEvent) => {
      try {
        if (!event.entityId) {
          ctx.logger.warn("issue.updated event missing entityId; skipping");
          return;
        }
        const deps = await buildDeps(ctx);
        await handleIssueUpdated(deps, {
          issueId: event.entityId,
          companyId: event.companyId,
        });
      } catch (err) {
        ctx.logger.error("issue.updated handler failed", {
          issueId: event.entityId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
