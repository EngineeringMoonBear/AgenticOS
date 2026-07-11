import { AsyncResource } from "node:async_hooks";
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
  resolveMirrorClosureStatus,
  type SyncDeps,
} from "./sync.js";
import { resolveRouting, type LabelRouting } from "./routing.js";
import {
  anyFrontendMatch,
  buildNewCommitsNote,
  buildPipelineErrorPing,
  buildReReviewPing,
  buildReviewIssueBody,
  buildReviewIssueTitle,
  buildReviewIssuesCreatedPing,
  CHECK_CONTEXT,
  decideReviewAction,
  DEFAULT_FRONTEND_PATHS,
  isActionablePrAction,
  isNullBodyStatusError,
  parseGithubPrEvent,
  shortSha,
  type GithubPrEvent,
  type Reviewer,
} from "./pr-review.js";
import { getReviewRecord, upsertReviewRecord } from "./pr-review-store.js";
import { handleReviewSignoff } from "./pr-signoff.js";
import { recordError, buildSwallowedFailurePing } from "./error-log.js";

/** Manifest-declared inbound webhook endpoint keys (GitHub → Paperclip). */
/** Custom Actions-workflow path: a signed {repo,number,title,body,url} payload. */
const INBOUND_ENDPOINT_KEY = "github-issue";
/** Native GitHub App path: GitHub's own signed `issues` event, one App webhook for all repos. */
const APP_WEBHOOK_ENDPOINT_KEY = "github-app";
/** GitHub App `pull_request` event path: the agent PR review pipeline (GOL-158). */
const PR_WEBHOOK_ENDPOINT_KEY = "github-pr";

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
   * Superseded by labelRouting/fallbackAssigneeAgentId (v0.6.0) when those are
   * set; kept as the backward-compatible last resort.
   */
  defaultAssigneeAgentId?: string;
  /**
   * Discipline routing by GitHub label (v0.6.0, GOL-150). label name → agent id.
   * Precedence infra=bug=alert > frontend > feature (see routing.ts). A matched
   * label assigns the mirror to that discipline's owner.
   */
  labelRouting?: LabelRouting;
  /**
   * Assignee when no routing label matches (v0.6.0 triage owner, e.g. CEO). Takes
   * precedence over defaultAssigneeAgentId for the no-label case.
   */
  fallbackAssigneeAgentId?: string;
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
  /** PR review pipeline (GOL-158): agent that always reviews. Unset → pipeline off. */
  prReviewAliceAgentId?: string;
  /** PR review pipeline: agent that additionally reviews when frontend paths change. */
  prReviewIrisAgentId?: string;
  /** Changed-file globs that trigger the frontend (Iris) review. Defaults applied at use. */
  prReviewFrontendPaths?: string[];
}

function readConfig(raw: Record<string, unknown>): GithubSyncConfig {
  const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
  const bridges: BridgeConfig[] = rawBridges
    .map((b) => {
      const o = (b ?? {}) as Record<string, unknown>;
      const rawPriority = typeof o.defaultPriority === "string" ? o.defaultPriority.toLowerCase() : "";
      const defaultAssigneeAgentId = o.defaultAssigneeAgentId ? String(o.defaultAssigneeAgentId) : undefined;
      const fallbackAssigneeAgentId = o.fallbackAssigneeAgentId ? String(o.fallbackAssigneeAgentId) : undefined;
      // labelRouting: keep only string→non-empty-string entries. An empty/invalid
      // map is dropped (undefined) so resolveRouting falls straight to fallback.
      const labelRouting =
        o.labelRouting && typeof o.labelRouting === "object" && !Array.isArray(o.labelRouting)
          ? Object.fromEntries(
              Object.entries(o.labelRouting as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string" && v)
                .map(([k, v]) => [k, String(v)]),
            )
          : undefined;
      return {
        githubOrg: String(o.githubOrg ?? "EngineeringMoonBear"),
        githubRepo: String(o.githubRepo ?? ""),
        paperclipProjectId: String(o.paperclipProjectId ?? ""),
        syncLabelPaperclip: String(o.syncLabelPaperclip ?? "synced-from-paperclip"),
        syncMarkerGithub: String(o.syncMarkerGithub ?? "synced-from-github"),
        defaultAssigneeAgentId,
        fallbackAssigneeAgentId,
        ...(labelRouting && Object.keys(labelRouting).length > 0 ? { labelRouting } : {}),
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
    prReviewAliceAgentId: raw.prReviewAliceAgentId ? String(raw.prReviewAliceAgentId) : undefined,
    prReviewIrisAgentId: raw.prReviewIrisAgentId ? String(raw.prReviewIrisAgentId) : undefined,
    prReviewFrontendPaths: Array.isArray(raw.prReviewFrontendPaths)
      ? raw.prReviewFrontendPaths.filter((p): p is string => typeof p === "string" && p.length > 0)
      : undefined,
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
    // Discord acks a successful webhook post with 204 No Content, which the SDK's
    // http.fetch surfaces as a thrown "Invalid response status code 204" (the
    // WHATWG Response constructor rejects a body on a null-body status). Treat
    // that as success — otherwise every ops ping looks like it failed, which is
    // why pipeline errors were invisible for weeks (GOL-179).
    if (isNullBodyStatusError(err)) return;
    ctx.logger.warn("ops webhook ping error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a SWALLOWED worker failure (GOL-296) to every sink we own, so a caught
 * exception is never invisible-until-a-server.log-dig again:
 *   1. `ctx.logger.error` — host stderr (unchanged; preserves the prior behaviour).
 *   2. the `github_sync_error` table — a durable, queryable per-plugin sink
 *      (`SELECT … ORDER BY occurred_at DESC`) reachable without server.log access.
 *   3. a 🚨 Discord ops-webhook alert — real-time paging when a delivery 200s with
 *      no mirror.
 * Sinks 2 and 3 are best-effort: the failure being reported must never be masked by
 * a secondary failure while writing it down.
 */
async function recordSwallowedFailure(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  scope: string,
  err: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  ctx.logger.error(scope, { ...context, error: detail });
  try {
    await recordError(ctx.db, {
      occurredAt: new Date().toISOString(),
      scope,
      detail,
      context,
    });
  } catch (writeErr) {
    ctx.logger.warn("failed to persist swallowed failure to github_sync_error", {
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }
  await postOpsPing(ctx, cfg.opsWebhookUrl, buildSwallowedFailurePing(scope, detail));
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
  cfg: GithubSyncConfig,
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
      // Swallowed here so one bad event never throws back onto the bus. Report it to
      // every sink we own (log + github_sync_error + Discord) so it isn't invisible.
      await recordSwallowedFailure(ctx, cfg, `${eventName} handler failed`, err, {
        issueId: event.entityId,
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
  labels: readonly string[] = [],
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

  // Discipline routing (GOL-150, v0.6.0): resolve the assignee from the issue's
  // GitHub labels, falling back to the triage owner, then the legacy default
  // (GOL-80). Without an assignee the mirror lands unowned and no agent ever picks
  // it up (heartbeat rule #1), so an unresolved routing is surfaced loudly below.
  const routing = resolveRouting(bridge, labels);
  const assigneeAgentId = routing.assigneeAgentId;
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
    routing: routing.reason,
    routedByLabel: routing.matchedLabel ?? null,
  });

  if (!assigneeAgentId) {
    // Surface the misconfiguration loudly: an unassigned mirror is the exact
    // silent-pileup failure GOL-80 exists to close.
    ctx.logger.warn(
      "inbound: mirror created UNASSIGNED — configure the bridge's labelRouting/fallbackAssigneeAgentId (or defaultAssigneeAgentId) so it enters an agent heartbeat",
      { repo: payload.repo, number: payload.number, projectId: bridge.paperclipProjectId },
    );
  }

  // Ops visibility: best-effort ping so inbound triage is never silent, and the
  // routing decision (which discipline label matched, or fallback) is visible.
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
      routedByLabel: routing.matchedLabel,
      routedByFallback: routing.reason === "fallback" || routing.reason === "default",
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
 * Inbound closure propagation (GitHub → Paperclip). When an agent PR merges with
 * a `Closes #N` keyword, GitHub natively closes issue #N and fires an `issues`
 * `closed` App-webhook event; `reopened` is the inverse. We look up the mirror
 * mapping and, when the mirror's status actually needs to change, write the new
 * Paperclip status. Unlike the `opened` path this deliberately DOES act on
 * Paperclip-origin issues — the whole point is to close the mirror of an issue
 * whose GitHub twin we created outbound.
 *
 * Loop safety: `resolveMirrorClosureStatus` returns null when the mirror already
 * matches, so the outbound-close → GitHub-`closed`-echo → inbound path is a no-op
 * and never bounces. We do not create a mirror on close/reopen — an unmapped
 * GitHub issue has no Paperclip twin to propagate to.
 */
async function handleAppClosure(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  event: { action: string; payload: InboundPayload },
): Promise<void> {
  const bridge = matchBridge(cfg, event.payload.repo);
  if (!bridge) {
    ctx.logger.info("app webhook: closure for repo not in a synced bridge; ignoring", {
      repo: event.payload.repo,
    });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("app webhook: companyId not configured — cannot propagate closure");
    return;
  }

  const mapping = await getByRepoNumber(ctx.db, event.payload.repo, event.payload.number);
  if (!mapping) {
    // No mirror exists — nothing to propagate. (We only mirror on `opened`.)
    ctx.logger.info("app webhook: closure for unmapped issue; nothing to propagate", {
      repo: event.payload.repo,
      number: event.payload.number,
      action: event.action,
    });
    return;
  }

  const issue = await ctx.issues.get(mapping.paperclipIssueId, cfg.companyId);
  if (!issue) {
    ctx.logger.warn("app webhook: mirror issue not readable; skipping closure", {
      issueId: mapping.paperclipIssueId,
    });
    return;
  }

  const target = resolveMirrorClosureStatus(event.action, issue.status);
  if (!target) {
    // Already in sync — the loop guard. No update, no bounce.
    ctx.logger.info("app webhook: mirror already in sync; skipping (loop guard)", {
      issueId: issue.id,
      action: event.action,
      status: issue.status,
    });
    return;
  }

  await ctx.issues.update(issue.id, { status: target }, cfg.companyId);
  await upsert(ctx.db, { ...mapping, lastSyncedAt: new Date().toISOString() });

  ctx.logger.info("app webhook: propagated GitHub closure to Paperclip mirror", {
    issueId: issue.id,
    repo: event.payload.repo,
    number: event.payload.number,
    action: event.action,
    status: target,
  });
}

/**
 * Native GitHub App endpoint (`github-app`): GitHub delivers its own signed
 * `issues` event for EVERY installed repo. We verify the App webhook secret,
 * mirror `opened` issues (skipping Paperclip-origin via the label guard), and
 * propagate `closed`/`reopened` onto an existing mirror (closure propagation).
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

  // Closure propagation (GitHub → Paperclip): a merged `Closes #N` PR closes the
  // GitHub issue → `closed`; `reopened` is the inverse. Handled before the
  // opened-only guard, and intentionally without the Paperclip-origin label skip.
  if (event.action === "closed" || event.action === "reopened") {
    await handleAppClosure(ctx, cfg, event);
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

  // Pass the issue's labels so discipline routing (v0.6.0) can pick the assignee.
  await createMirrorIssue(ctx, cfg, bridge, event.payload, event.labels);
}

/**
 * Build a write-capable GitHubClient for one bridge, preferring the gh-token-broker
 * (repo-scoped App tokens, cross-org) and falling back to a static PAT. Returns
 * null when no auth is available. Used by the PR pipeline's onWebhook path, which
 * (unlike setup) has no prebuilt per-project client to hand.
 */
function makeBridgeGithubClient(cfg: GithubSyncConfig, bridge: BridgeConfig): GitHubClient | null {
  const brokerUrl = cfg.tokenBrokerUrl || process.env.GH_TOKEN_BROKER_URL || "";
  if (brokerUrl) {
    return new GitHubClient({ org: bridge.githubOrg, getToken: makeBrokerTokenProvider(brokerUrl, bridge.githubOrg) });
  }
  if (cfg.githubToken) {
    return new GitHubClient({ org: bridge.githubOrg, getToken: staticTokenProvider(cfg.githubToken) });
  }
  return null;
}

/** Outcome of processing one reviewer for a PR event, for ping aggregation. */
type ReviewOutcome = "created" | "reopened" | "noop";

/**
 * Native GitHub App `pull_request` endpoint (`github-pr`): the agent PR review
 * pipeline (GOL-158, spec System 2). Verifies the App webhook secret, filters to
 * non-draft actionable actions, fetches the PR's changed files via the broker
 * token, then per reviewer (Alice always; Iris when a changed path matches the
 * frontend globs):
 *   - creates a review issue in the matched bridge's project (first time), or
 *   - reopens it with a "new commits" note when the head SHA changed, and
 *   - seeds/resets a pending `agent-review/*` check-run on the head SHA (best-effort).
 * Idempotent per (repo, PR, head SHA) via the github_pr_review store.
 */
/**
 * Runs a thunk inside a previously-captured async context. See
 * {@link captureInvocationScope}.
 */
type InvocationScopeRunner = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * Snapshot the current async execution context so privileged `ctx.issues.*`
 * calls made *after* an outbound fetch still carry the host invocation scope.
 *
 * WHY: the SDK attaches the per-invocation scope to a privileged host call only
 * when its AsyncLocalStorage store is present (worker-rpc-host sends
 * `paperclipInvocationId` iff `getStore()` is truthy). The PR path must call
 * `github.listPullFiles()` first — an outbound undici `fetch` (github-client +
 * broker use the global `fetch`, not `ctx.http.fetch`) that drops the async
 * context. By the time we reach `ctx.issues.create` the store is gone and the
 * host rejects the write: "not allowed to perform issues.create: missing,
 * expired, or unknown invocation scope" (GOL-179, root-caused in GOL-178).
 *
 * We can't simply reorder the writes before the fetch: both the Iris reviewer
 * decision and the issue body need the fetched file list. Instead we capture the
 * context while it's still valid (before any outbound fetch) and re-enter it for
 * each privileged write. `ctx.http.fetch`/`ctx.logger` don't need the scope, so
 * the ops pings that run after the fetch are unaffected — and so is `ctx.db`,
 * whose namespace calls the host authorizes without the invocation scope.
 */
function captureInvocationScope(): InvocationScopeRunner {
  return AsyncResource.bind(<T>(fn: () => Promise<T>): Promise<T> => fn());
}

async function handlePrInbound(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  input: PluginWebhookInput,
): Promise<void> {
  if (!cfg.appWebhookSecret) {
    ctx.logger.error("pr webhook: no appWebhookSecret configured — rejecting");
    return;
  }
  if (!verifyGithubSignature(input.rawBody, cfg.appWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    ctx.logger.warn("pr webhook: signature verification failed");
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildPipelineErrorPing("HMAC verification failed on a github-pr delivery"));
    return;
  }

  // GitHub sets X-GitHub-Event; ignore anything but `pull_request`. Lenient if absent.
  const eventType = getHeader(input.headers, "x-github-event");
  if (eventType && eventType !== "pull_request") {
    ctx.logger.info("pr webhook: ignoring non-pull_request event", { eventType });
    return;
  }

  const ev = parseGithubPrEvent(input.parsedBody ?? safeJson(input.rawBody));
  if (!ev) {
    ctx.logger.warn("pr webhook: unparseable/invalid pull_request payload");
    return;
  }
  if (ev.draft) {
    ctx.logger.info("pr webhook: skipping draft PR", { repo: ev.repo, number: ev.number });
    return; // silent on drafts (spec System 3)
  }
  if (!isActionablePrAction(ev.action)) {
    ctx.logger.info("pr webhook: ignoring PR action", { action: ev.action, repo: ev.repo, number: ev.number });
    return;
  }

  const bridge = matchBridge(cfg, ev.repo);
  if (!bridge) {
    ctx.logger.info("pr webhook: repo not in a synced bridge; ignoring", { repo: ev.repo });
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("pr webhook: companyId not configured — cannot create review issues");
    return;
  }
  if (!cfg.prReviewAliceAgentId) {
    ctx.logger.info("pr webhook: PR review pipeline disabled (no prReviewAliceAgentId configured)");
    return;
  }

  const github = makeBridgeGithubClient(cfg, bridge);
  if (!github) {
    ctx.logger.warn("pr webhook: no auth for bridge — cannot fetch PR files", { repo: ev.repo });
    return;
  }

  // Capture the invocation scope BEFORE listPullFiles' outbound fetch drops the
  // async context; every privileged ctx.issues.* write below is re-entered into
  // it via `runInScope`. See captureInvocationScope (GOL-179).
  const runInScope = captureInvocationScope();

  const filesRes = await github.listPullFiles(bridge.githubRepo, ev.number);
  if (!filesRes.ok) {
    ctx.logger.error("pr webhook: failed to fetch PR changed files", { repo: ev.repo, number: ev.number, error: filesRes.error });
    await postOpsPing(
      ctx,
      cfg.opsWebhookUrl,
      buildPipelineErrorPing(`could not list files for ${ev.repo}#${ev.number}: ${filesRes.error}`),
    );
    return;
  }
  const { files, truncated } = filesRes.data;
  if (truncated) {
    ctx.logger.warn("pr webhook: changed-file list truncated at the page cap — frontend match may under-report", {
      repo: ev.repo,
      number: ev.number,
    });
  }

  // Decide reviewers: Alice always; Iris when a changed path matches the frontend globs.
  const frontendPaths = cfg.prReviewFrontendPaths?.length ? cfg.prReviewFrontendPaths : DEFAULT_FRONTEND_PATHS;
  const isFrontend = anyFrontendMatch(files, frontendPaths);
  const reviewers: Array<{ reviewer: Reviewer; agentId: string }> = [
    { reviewer: "alice", agentId: cfg.prReviewAliceAgentId },
  ];
  if (isFrontend && cfg.prReviewIrisAgentId) {
    reviewers.push({ reviewer: "iris", agentId: cfg.prReviewIrisAgentId });
  }

  const created: Reviewer[] = [];
  const reopened: Reviewer[] = [];
  for (const { reviewer, agentId } of reviewers) {
    try {
      const outcome = await processReviewer(ctx, cfg, bridge, github, ev, files, reviewer, agentId, runInScope);
      if (outcome === "created") created.push(reviewer);
      else if (outcome === "reopened") reopened.push(reviewer);
    } catch (err) {
      ctx.logger.error("pr webhook: reviewer processing failed", {
        repo: ev.repo,
        number: ev.number,
        reviewer,
        error: err instanceof Error ? err.message : String(err),
      });
      await postOpsPing(
        ctx,
        cfg.opsWebhookUrl,
        buildPipelineErrorPing(`review-issue handling failed for ${ev.repo}#${ev.number} (${reviewer})`),
      );
    }
  }

  // Low-noise, state-change-only pings (spec System 3): one per PR per transition.
  if (created.length) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReviewIssuesCreatedPing(ev, created));
  }
  if (reopened.length) {
    await postOpsPing(ctx, cfg.opsWebhookUrl, buildReReviewPing(ev, reopened));
  }
}

/**
 * Create-or-reopen the review issue for one reviewer, seeding/resetting the
 * pending check-run. Idempotent per head SHA (see github_pr_review):
 *   - no record            → create the review issue
 *   - record, same headSha → redelivery, no-op
 *   - record, new headSha  → reopen (todo) + "new commits" note (synchronize)
 */
async function processReviewer(
  ctx: PluginContext,
  cfg: GithubSyncConfig,
  bridge: BridgeConfig,
  github: GitHubClient,
  ev: GithubPrEvent,
  files: readonly string[],
  reviewer: Reviewer,
  agentId: string,
  runInScope: InvocationScopeRunner,
): Promise<ReviewOutcome> {
  const existing = await getReviewRecord(ctx.db, ev.repo, ev.number, reviewer);
  const action = decideReviewAction(existing ? existing.headSha : null, ev.headSha);
  if (action === "noop") {
    ctx.logger.info("pr webhook: already reviewed at this head SHA; skipping", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      headSha: ev.headSha,
    });
    return "noop";
  }

  const now = new Date().toISOString();
  if (action === "create" || !existing) {
    const issue = await runInScope(() =>
      ctx.issues.create({
        companyId: cfg.companyId!,
        projectId: bridge.paperclipProjectId,
        title: buildReviewIssueTitle(reviewer, ev),
        description: buildReviewIssueBody(reviewer, ev, files),
        status: "todo",
        priority: bridge.defaultPriority ?? "medium",
        assigneeAgentId: agentId,
      }),
    );
    await upsertReviewRecord(ctx.db, {
      githubRepo: ev.repo,
      prNumber: ev.number,
      reviewer,
      headSha: ev.headSha,
      paperclipIssueId: issue.id,
      updatedAt: now,
    });
    ctx.logger.info("pr webhook: created review issue", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      issueId: issue.id,
      assigneeAgentId: agentId,
    });
    await seedPendingCheck(ctx, github, bridge, ev, reviewer);
    return "created";
  }

  // New head SHA on an existing review: reopen + note, reset the pending check.
  await runInScope(() => ctx.issues.update(existing.paperclipIssueId, { status: "todo" }, cfg.companyId!));
  await runInScope(() =>
    ctx.issues.createComment(existing.paperclipIssueId, buildNewCommitsNote(reviewer, ev), cfg.companyId!),
  );
  await upsertReviewRecord(ctx.db, {
    githubRepo: ev.repo,
    prNumber: ev.number,
    reviewer,
    headSha: ev.headSha,
    paperclipIssueId: existing.paperclipIssueId,
    updatedAt: now,
  });
  ctx.logger.info("pr webhook: reopened review issue for new commits", {
    repo: ev.repo,
    number: ev.number,
    reviewer,
    issueId: existing.paperclipIssueId,
    headSha: ev.headSha,
  });
  await seedPendingCheck(ctx, github, bridge, ev, reviewer);
  return "reopened";
}

/**
 * Seed/reset a pending `agent-review/*` check-run on the PR head SHA. Best-effort:
 * a failure (e.g. the App lacks `checks:write` during the Phase 2 soak) is logged
 * but never blocks review-issue creation, and — to keep the ops channel low-noise
 * during rollout — is NOT pinged. The check is completed to success later by
 * handleReviewSignoff (pr-signoff.ts, GOL-186) when the review issue closes `done`.
 */
async function seedPendingCheck(
  ctx: PluginContext,
  github: GitHubClient,
  bridge: BridgeConfig,
  ev: GithubPrEvent,
  reviewer: Reviewer,
): Promise<void> {
  const res = await github.createCheckRun(bridge.githubRepo, {
    name: CHECK_CONTEXT[reviewer],
    headSha: ev.headSha,
    title: `Agent review pending (${reviewer})`,
    summary: `Awaiting ${reviewer}'s review of ${ev.repo}#${ev.number} @ \`${shortSha(ev.headSha)}\`. Non-required during Phase 2 soak (GOL-158).`,
    detailsUrl: ev.url || undefined,
  });
  if (!res.ok) {
    ctx.logger.warn("pr webhook: pending check-run seed failed (needs App checks:write?)", {
      repo: ev.repo,
      number: ev.number,
      reviewer,
      error: res.error,
    });
  }
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
        postOpsPing: (content) => postOpsPing(ctx, cfg.opsWebhookUrl, content),
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
    ctx.events.on("issue.created", makeDispatch(ctx, cfg, depsByProject, handleIssueCreated, "issue.created"));
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleIssueUpdated, "issue.updated"));
    // Second issue.updated dispatch: complete the agent-review check-run when a PR
    // review issue closes `done` (GOL-186). Independent of the mirror path above —
    // it early-returns on issues with no github_pr_review row, and the mirror path
    // early-returns on unmapped review issues, so they never collide.
    ctx.events.on("issue.updated", makeDispatch(ctx, cfg, depsByProject, handleReviewSignoff, "issue.updated:signoff"));

    ctx.logger.info("github sync listening", {
      projects: Array.from(depsByProject.keys()),
    });
  },

  /**
   * Inbound leg (GitHub → Paperclip). The host routes three public endpoints here:
   *   - `POST …/webhooks/github-issue` → a custom Actions-workflow payload,
   *   - `POST …/webhooks/github-app`   → the App's single webhook URL: `issues` and
   *       `pull_request` both arrive here and are fanned out by X-GitHub-Event, or
   *   - `POST …/webhooks/github-pr`    → GitHub's native `pull_request` event (review
   *       pipeline) via a direct-ingress path (e.g. Terra's CF bypass).
   * Each verifies its own HMAC (the plugin's responsibility) then creates the
   * mirror/review issue directly — routines can't, since every routine run needs an agent.
   */
  async onWebhook(input: PluginWebhookInput): Promise<void> {
    const ctx = currentContext;
    if (!ctx) return;

    // `cfg` is read INSIDE the try: a throw from ctx.config.get()/readConfig used to
    // escape onWebhook and surface only as the host's opaque "host handler error"
    // line in server.log (GOL-296). Capturing it here means every failure path — not
    // just handler bodies — reaches recordSwallowedFailure below.
    let cfg: GithubSyncConfig | undefined;
    try {
      cfg = readConfig(await ctx.config.get());
      if (input.endpointKey === INBOUND_ENDPOINT_KEY) {
        await handleCustomInbound(ctx, cfg, input);
      } else if (input.endpointKey === APP_WEBHOOK_ENDPOINT_KEY) {
        // A GitHub App has a single webhook URL, so once the App is subscribed to
        // `pull_request` those deliveries also land on `github-app` (not the separate
        // `github-pr` endpoint, which the App can't point a second event type at).
        // Fan out by X-GitHub-Event: `pull_request` → the review pipeline, everything
        // else → the issues-mirror handler (which self-filters to `issues`). The
        // dedicated `github-pr` endpoint remains a valid direct-ingress path; each
        // handler verifies the same appWebhookSecret, so both routes are equivalent.
        if (getHeader(input.headers, "x-github-event") === "pull_request") {
          await handlePrInbound(ctx, cfg, input);
        } else {
          await handleAppInbound(ctx, cfg, input);
        }
      } else if (input.endpointKey === PR_WEBHOOK_ENDPOINT_KEY) {
        await handlePrInbound(ctx, cfg, input);
      } else {
        ctx.logger.warn("inbound webhook: unknown endpoint", { endpointKey: input.endpointKey });
      }
    } catch (err) {
      const scope = `inbound webhook: handler failed (${input.endpointKey})`;
      if (cfg) {
        await recordSwallowedFailure(ctx, cfg, scope, err, { endpointKey: input.endpointKey });
      } else {
        // The config read itself threw — we have no opsWebhookUrl to page, but the DB
        // namespace is config-independent, so still persist to the queryable sink.
        const detail = err instanceof Error ? err.message : String(err);
        ctx.logger.error(scope, { endpointKey: input.endpointKey, error: detail });
        try {
          await recordError(ctx.db, {
            occurredAt: new Date().toISOString(),
            scope,
            detail,
            context: { endpointKey: input.endpointKey },
          });
        } catch {
          // best-effort; host stderr above is the floor.
        }
      }
    }
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
