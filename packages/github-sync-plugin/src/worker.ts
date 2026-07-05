import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginEvent, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { makeBrokerTokenProvider, staticTokenProvider } from "./broker.js";
import { getByRepoNumber, upsert } from "./mapping.js";
import {
  buildInboundDescription,
  buildMirrorOpsMessage,
  getHeader,
  parseGithubAppIssueEvent,
  parseInboundPayload,
  verifyGithubSignature,
  type InboundPayload,
} from "./inbound.js";
import {
  handleIssueCreated,
  handleIssueUpdated,
  type SyncDeps,
} from "./sync.js";

/** Manifest-declared inbound webhook endpoint keys (GitHub → Paperclip). */
/** Custom Actions-workflow path: a signed {repo,number,title,body,url} payload. */
const INBOUND_ENDPOINT_KEY = "github-issue";
/** Native GitHub App path: GitHub's own signed `issues` event, one App webhook for all repos. */
const APP_WEBHOOK_ENDPOINT_KEY = "github-app";

/** Captured in setup() so onWebhook (which only receives `input`) can reach ctx. */
let currentContext: PluginContext | null = null;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Paperclip issue priorities (mirrors Issue["priority"] without importing the type). */
type IssuePriority = "critical" | "high" | "medium" | "low";
const PRIORITIES: readonly IssuePriority[] = ["critical", "high", "medium", "low"];

/** One repo ↔ project bridge. The same plugin can carry several (pluginKey is unique). */
interface BridgeConfig {
  githubOrg: string;
  githubRepo: string;
  paperclipProjectId: string;
  syncLabelPaperclip: string;
  syncMarkerGithub: string;
  /**
   * Deterministic default routing (GOL-80). When set, inbound mirror issues are
   * created ASSIGNED to this agent so they enter its heartbeat automatically —
   * without this a mirror lands unassigned and Paperclip agents never pick up
   * unassigned work (heartbeat rule #1), so GitHub issues pile up unowned.
   */
  defaultAssigneeAgentId?: string;
  /** Priority for mirror issues from this bridge. Defaults to "medium". */
  defaultPriority?: IssuePriority;
}

interface GithubSyncConfig {
  bridges: BridgeConfig[];
  /** Override for GH_TOKEN_BROKER_URL (set if the env isn't passed to plugin workers). */
  tokenBrokerUrl?: string;
  /** Optional static-PAT fallback, used only when no broker is configured. */
  githubToken?: string;
  /** Company owning the synced projects — required to create inbound mirror issues. */
  companyId?: string;
  /** HMAC secret for the custom inbound GitHub webhook (verifies X-Hub-Signature-256). */
  inboundWebhookSecret?: string;
  /** HMAC secret configured on the GitHub App's webhook (native `issues` events). */
  appWebhookSecret?: string;
  /**
   * Optional Discord (or Discord-compatible) webhook URL. When set, the plugin
   * posts a best-effort ops ping on every mirror creation so inbound triage is
   * never silent (GOL-80). A failed ping never blocks mirror creation.
   */
  opsWebhookUrl?: string;
}

function readConfig(raw: Record<string, unknown>): GithubSyncConfig {
  const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
  const bridges: BridgeConfig[] = rawBridges
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const rawPriority = typeof o.defaultPriority === "string" ? o.defaultPriority.toLowerCase() : "";
      const defaultAssigneeAgentId = o.defaultAssigneeAgentId ? String(o.defaultAssigneeAgentId) : undefined;
      return {
        githubOrg: String(o.githubOrg ?? "EngineeringMoonBear"),
        githubRepo: String(o.githubRepo ?? ""),
        paperclipProjectId: String(o.paperclipProjectId ?? ""),
        syncLabelPaperclip: String(o.syncLabelPaperclip ?? "synced-from-paperclip"),
        syncMarkerGithub: String(o.syncMarkerGithub ?? "synced-from-github"),
        defaultAssigneeAgentId,
        // Invalid/absent priority silently falls back to "medium" at create time.
        defaultPriority: (PRIORITIES as readonly string[]).includes(rawPriority)
          ? (rawPriority as IssuePriority)
          : undefined,
      };
    })
    // A bridge without a repo or project can't sync anything — drop it.
    .filter((b) => b.githubRepo && b.paperclipProjectId);

  return {
    bridges,
    tokenBrokerUrl: raw.tokenBrokerUrl ? String(raw.tokenBrokerUrl) : undefined,
    githubToken: raw.githubToken ? String(raw.githubToken) : undefined,
    companyId: raw.companyId ? String(raw.companyId) : undefined,
    inboundWebhookSecret: raw.inboundWebhookSecret ? String(raw.inboundWebhookSecret) : undefined,
    appWebhookSecret: raw.appWebhookSecret ? String(raw.appWebhookSecret) : undefined,
    opsWebhookUrl: raw.opsWebhookUrl ? String(raw.opsWebhookUrl) : undefined,
  };
}

/**
 * Best-effort ops-visibility ping (GOL-80). Posts a Discord-style `{content}`
 * message to the configured webhook. Any failure is logged and swallowed — mirror
 * creation must never depend on the ops channel being reachable.
 */
async function postOpsPing(ctx: PluginContext, webhookUrl: string | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await ctx.http.fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      ctx.logger.warn("ops webhook ping failed", { status: res.status });
    }
  } catch (err) {
    ctx.logger.warn("ops webhook ping error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

/** Find the bridge whose repo matches "org/repo" or the bare repo name. */
function matchBridge(cfg: GithubSyncConfig, repo: string): BridgeConfig | undefined {
  return cfg.bridges.find(
    (b) =>
      `${b.githubOrg}/${b.githubRepo}`.toLowerCase() === repo.toLowerCase() ||
      b.githubRepo.toLowerCase() === repo.toLowerCase(),
  );
}

/**
 * Shared inbound tail. Dedupe an already-mirrored GitHub issue, else create the
 * mirror Paperclip issue and record the mapping (origin "github") up front so the
 * issue.created event it triggers is seen as already-mapped and NOT bounced back.
 */
async function createMirrorIssue(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  bridge: BridgeConfig,
  payload: InboundPayload,
): Promise<void> {
  if (!cfg.companyId) {
    ctx.logger.error("inbound webhook: companyId not configured — cannot create issue");
    return;
  }

  // Idempotency: skip redeliveries of an already-mirrored GitHub issue. This also
  // catches Paperclip-origin issues (outbound sync recorded their mapping first).
  const existing = await getByRepoNumber(ctx.db, payload.repo, payload.number);
  if (existing) {
    ctx.logger.info("inbound webhook: already mirrored; skipping", {
      repo: payload.repo,
      number: payload.number,
    });
    return;
  }

  // Deterministic default routing (GOL-80): assign the mirror to the bridge's
  // configured owner so it enters an agent heartbeat automatically. Without an
  // assignee the mirror lands unowned and no agent ever picks it up.
  const assigneeAgentId = bridge.defaultAssigneeAgentId;
  const issue = await ctx.issues.create({
    companyId: cfg.companyId,
    projectId: bridge.paperclipProjectId,
    title: payload.title,
    description: buildInboundDescription(payload),
    status: "todo",
    priority: bridge.defaultPriority ?? "medium",
    ...(assigneeAgentId ? { assigneeAgentId } : {}),
  });

  await upsert(ctx.db, {
    paperclipIssueId: issue.id,
    githubRepo: payload.repo,
    githubIssueNumber: payload.number,
    lastSyncedAt: new Date().toISOString(),
    origin: "github",
  });

  ctx.logger.info("inbound: created Paperclip issue from GitHub", {
    repo: payload.repo,
    number: payload.number,
    projectId: bridge.paperclipProjectId,
    issueId: issue.id,
    assigneeAgentId: assigneeAgentId ?? null,
  });

  if (!assigneeAgentId) {
    // Surface the misconfiguration loudly: an unassigned mirror is the exact
    // silent-pileup failure GOL-80 exists to close.
    ctx.logger.warn(
      "inbound: mirror created UNASSIGNED — set the bridge's defaultAssigneeAgentId so it enters an agent heartbeat",
      { repo: payload.repo, number: payload.number, projectId: bridge.paperclipProjectId },
    );
  }

  // Ops visibility: best-effort ping so inbound triage is never silent.
  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildMirrorOpsMessage({
      repo: payload.repo,
      number: payload.number,
      title: payload.title,
      url: payload.url,
      projectId: bridge.paperclipProjectId,
      issueId: issue.id,
      assigneeAgentId,
    }),
  );
}

/**
 * Custom Actions-workflow endpoint (`github-issue`): a per-repo workflow signs a
 * `{repo,number,title,body,url}` payload with the shared `inboundWebhookSecret`.
 */
async function handleCustomInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
): Promise<void> {
  if (!cfg.inboundWebhookSecret) {
    ctx.logger.error("inbound webhook: no inboundWebhookSecret configured — rejecting");
    return;
  }
  if (!verifyGithubSignature(input.rawBody, cfg.inboundWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    ctx.logger.warn("inbound webhook: signature verification failed");
    return;
  }

  const payload = parseInboundPayload(input.parsedBody ?? safeJson(input.rawBody));
  if (!payload) {
    ctx.logger.warn("inbound webhook: unparseable/invalid payload");
    return;
  }

  const bridge = matchBridge(cfg, payload.repo);
  if (!bridge) {
    ctx.logger.info("inbound webhook: repo not in a synced bridge; ignoring", { repo: payload.repo });
    return;
  }
  await createMirrorIssue(ctx, cfg, bridge, payload);
}

/**
 * Native GitHub App endpoint (`github-app`): GitHub delivers its own signed
 * `issues` event for EVERY installed repo. We verify the App webhook secret,
 * mirror only `opened` issues, and skip Paperclip-origin issues (label guard).
 */
async function handleAppInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
): Promise<void> {
  if (!cfg.appWebhookSecret) {
    ctx.logger.error("app webhook: no appWebhookSecret configured — rejecting");
    return;
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    ctx.logger.warn("app webhook: signature verification failed");
    return;
  }

  // GitHub sets X-GitHub-Event; ignore anything but `issues`. Lenient if absent.
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "issues") {
    ctx.logger.info("app webhook: ignoring non-issues event", { eventType });
    return;
  }

  const event = parseGithubAppIssueEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!event) {
    ctx.logger.warn("app webhook: unparseable/invalid issues payload");
    return;
  }
  if (event.action !== "opened") {
    ctx.logger.info("app webhook: ignoring issue action", { action: event.action });
    return;
  }

  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: repo not in a synced bridge; ignoring", { repo: event.payload.repo });
    return;
  }

  // Loop guard: never mirror an issue GitHub already shows as Paperclip-origin.
  // createMirrorIssue's getByRepoNumber dedupe also catches these, but the label
  // check avoids a needless read and is robust if the mapping row is missing.
  if (event.labels.some((l) => l.toLowerCase() === bridge.syncLabelPaperclip.toLowerCase())) {
    ctx.logger.info("app webhook: issue is Paperclip-origin (label); skipping", {
      repo: event.payload.repo,
      number: event.payload.number,
    });
    return;
  }

  await createMirrorIssue(ctx, cfg, bridge, event.payload);
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub Sync plugin starting");

    // Capture ctx for onWebhook (the inbound handler only receives `input`).
    currentContext = ctx;

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

  /**
   * Inbound leg (GitHub → Paperclip). The host routes two public endpoints here:
   *   - `POST …/webhooks/github-issue` → a custom Actions-workflow payload, or
   *   - `POST …/webhooks/github-app`   → GitHub's native `issues` App-webhook event.
   * Each verifies its own HMAC (the plugin's responsibility) then creates the
   * mirror issue directly — routines can't, since every routine run needs an agent.
   */
  async onWebhook(input: PluginWebhookInput): Promise<void> {
    const ctx = currentContext;
    if (!ctx) return;

    const cfg = readConfig(await ctx.config.get());
    try {
      if (input.endpointKey === INBOUND_ENDPOINT_KEY) {
        await handleCustomInbound(ctx, cfg, input);
      } else if (input.endpointKey === APP_WEBHOOK_ENDPOINT_KEY) {
        await handleAppInbound(ctx, cfg, input);
      } else {
        ctx.logger.warn("inbound webhook: unknown endpoint", { endpointKey: input.endpointKey });
      }
    } catch (err) {
      ctx.logger.error("inbound webhook: handler failed", {
        endpointKey: input.endpointKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
