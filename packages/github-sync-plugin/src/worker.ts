import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { makeBrokerTokenProvider, staticTokenProvider } from "./broker.js";
import {
  handleIssueCreated,
  handleIssueUpdated,
  type SyncDeps,
} from "./sync.js";

/** One repo ↔ project bridge. The same plugin can carry several (pluginKey is unique). */
interface BridgeConfig {
  githubOrg: string;
  githubRepo: string;
  paperclipProjectId: string;
  syncLabelPaperclip: string;
  syncMarkerGithub: string;
}

interface GithubSyncConfig {
  bridges: BridgeConfig[];
  /** Override for GH_TOKEN_BROKER_URL (set if the env isn't passed to plugin workers). */
  tokenBrokerUrl?: string;
  /** Optional static-PAT fallback, used only when no broker is configured. */
  githubToken?: string;
}

function readConfig(raw: Record<string, unknown>): GithubSyncConfig {
  const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
  const bridges: BridgeConfig[] = rawBridges
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return {
        githubOrg: String(o.githubOrg ?? "EngineeringMoonBear"),
        githubRepo: String(o.githubRepo ?? ""),
        paperclipProjectId: String(o.paperclipProjectId ?? ""),
        syncLabelPaperclip: String(o.syncLabelPaperclip ?? "synced-from-paperclip"),
        syncMarkerGithub: String(o.syncMarkerGithub ?? "synced-from-github"),
      };
    })
    // A bridge without a repo or project can't sync anything — drop it.
    .filter((b) => b.githubRepo && b.paperclipProjectId);

  return {
    bridges,
    tokenBrokerUrl: raw.tokenBrokerUrl ? String(raw.tokenBrokerUrl) : undefined,
    githubToken: raw.githubToken ? String(raw.githubToken) : undefined,
  };
}

/**
 * Route an issue event to the bridge for its project, with per-event error
 * isolation (a handler must never throw back onto the bus).
 *
 * WHY company-wide + in-handler routing instead of a `{ projectId }` subscription
 * filter: the host's issue.created/issue.updated events carry a DELTA payload that
 * does not reliably include `projectId` (the event-bus filter reads
 * `payload.projectId`, which is often absent), so a project-scoped filter silently
 * drops every event. We instead subscribe company-wide and read the full issue back
 * to learn its real project, then dispatch to the matching bridge — or skip if the
 * issue isn't in a synced project. Scoping to configured projects is preserved; it
 * just no longer depends on the event payload's shape.
 */
function makeDispatch(
  ctx: PluginContext,
  depsByProject: Map<string, SyncDeps>,
  handle: (deps: SyncDeps, input: { issueId: string; companyId: string }) => Promise<void>,
  eventName: string,
) {
  return async (event: PluginEvent) => {
    try {
      if (!event.entityId) {
        ctx.logger.warn(`${eventName} event missing entityId; skipping`);
        return;
      }
      const issue = await ctx.issues.get(event.entityId, event.companyId);
      if (!issue) {
        ctx.logger.warn(`${eventName}: issue not readable; skipping`, {
          issueId: event.entityId,
        });
        return;
      }
      const deps = issue.projectId ? depsByProject.get(issue.projectId) : undefined;
      if (!deps) return; // not in a synced project — ignore quietly
      await handle(deps, { issueId: event.entityId, companyId: event.companyId });
    } catch (err) {
      ctx.logger.error(`${eventName} handler failed`, {
        issueId: event.entityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Sync plugin starting");

    // The github_sync_mapping table is created by migrations/001_init.sql, applied
    // by the host before worker init — runtime DDL is not permitted by ctx.db.

    const cfg = readConfig(await ctx.config.get());
    if (cfg.bridges.length === 0) {
      ctx.logger.warn(
        "no bridges configured — GitHub Sync is INACTIVE. Set config.bridges = [{ githubOrg, githubRepo, paperclipProjectId }]. The plugin refuses to mirror company-wide.",
      );
      return;
    }

    // Auth: prefer the gh-token-broker (repo-scoped GitHub App installation tokens,
    // cross-org). Fall back to a static PAT only if no broker URL is available.
    const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";

    // Build a projectId → SyncDeps map. Subscriptions below are company-wide (the
    // event filter can't see projectId — see makeDispatch), so routing is by project.
    const depsByProject = new Map<string, SyncDeps>();
    for (const bridge of cfg.bridges) {
      let getToken;
      if (brokerUrl) {
        getToken = makeBrokerTokenProvider(brokerUrl, bridge.githubOrg);
      } else if (cfg.githubToken) {
        getToken = staticTokenProvider(cfg.githubToken);
      } else {
        ctx.logger.warn(
          `bridge ${bridge.githubOrg}/${bridge.githubRepo} has no auth (no GH_TOKEN_BROKER_URL / tokenBrokerUrl and no githubToken) — skipping`,
        );
        continue;
      }

      const github = new GitHubClient({ org: bridge.githubOrg, getToken });
      depsByProject.set(bridge.paperclipProjectId, {
        db: ctx.db,
        github,
        config: {
          githubRepo: bridge.githubRepo,
          syncLabelPaperclip: bridge.syncLabelPaperclip,
          syncMarkerGithub: bridge.syncMarkerGithub,
        },
        logger: ctx.logger,
        getIssue: (issueId, companyId) => ctx.issues.get(issueId, companyId),
      });

      ctx.logger.info("bridge active", {
        repo: `${bridge.githubOrg}/${bridge.githubRepo}`,
        projectId: bridge.paperclipProjectId,
        auth: brokerUrl ? "gh-token-broker" : "static token",
      });
    }

    if (depsByProject.size === 0) {
      ctx.logger.warn("no usable bridges (all missing auth) — GitHub Sync is INACTIVE.");
      return;
    }

    // One company-wide subscription per event type; makeDispatch routes each event
    // to the bridge for the issue's project (or drops it if not a synced project).
    ctx.events.on("issue.created", makeDispatch(ctx, depsByProject, handleIssueCreated, "issue.created"));
    ctx.events.on("issue.updated", makeDispatch(ctx, depsByProject, handleIssueUpdated, "issue.updated"));

    ctx.logger.info("github sync listening", {
      projects: Array.from(depsByProject.keys()),
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
