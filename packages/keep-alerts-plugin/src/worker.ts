import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, PluginWebhookInput } from "@paperclipai/plugin-sdk";
import {
  buildIssueDescription,
  buildOpsPing,
  buildRecurrenceComment,
  buildRefireComment,
  buildResolutionComment,
  getHeader,
  normalizeSeverity,
  parseKeepAlert,
  resolveOwnership,
  severityToPriority,
  shouldMint,
  verifyKeepSignature,
  DEFAULT_MINT_SEVERITIES,
  type KeepAlert,
  type OwnershipRule,
  type Severity,
} from "./alert.js";
import { getByFingerprint, insertNew, updateState } from "./mapping.js";

/** Manifest-declared inbound webhook endpoint key (Keep → Paperclip). */
const KEEP_ENDPOINT_KEY = "keep-alert";

/** Captured in setup() so onWebhook (which only receives `input`) can reach ctx. */
let currentContext: PluginContext | null = null;

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface KeepAlertsConfig {
  companyId?: string;
  projectId?: string;
  keepWebhookSecret?: string;
  defaultAssigneeAgentId?: string;
  mintSeverities: readonly Severity[];
  ownership: OwnershipRule[];
  opsWebhookUrl?: string;
}

function readConfig(raw: Record<string, unknown>): KeepAlertsConfig {
  const rawMint = Array.isArray(raw.mintSeverities) ? raw.mintSeverities : [];
  const mintSeverities = rawMint
    .map((s) => (typeof s === "string" ? s.toLowerCase().trim() : ""))
    .filter((s): s is Severity => (["critical", "high", "warning", "info", "low"] as string[]).includes(s));

  const rawOwnership = Array.isArray(raw.ownership) ? raw.ownership : [];
  const ownership: OwnershipRule[] = rawOwnership
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        match: String(o.match ?? ""),
        assigneeAgentId: String(o.assigneeAgentId ?? ""),
        projectId: o.projectId ? String(o.projectId) : undefined,
      };
    })
    // A rule without a match token or an assignee can't route anything — drop it.
    .filter((r) => r.match && r.assigneeAgentId);

  return {
    companyId: raw.companyId ? String(raw.companyId) : undefined,
    projectId: raw.projectId ? String(raw.projectId) : undefined,
    keepWebhookSecret: raw.keepWebhookSecret ? String(raw.keepWebhookSecret) : undefined,
    defaultAssigneeAgentId: raw.defaultAssigneeAgentId ? String(raw.defaultAssigneeAgentId) : undefined,
    // Empty/absent list falls back to the agreed default gate.
    mintSeverities: mintSeverities.length ? mintSeverities : DEFAULT_MINT_SEVERITIES,
    ownership,
    opsWebhookUrl: raw.opsWebhookUrl ? String(raw.opsWebhookUrl) : undefined,
  };
}

/**
 * Best-effort ops-visibility ping. Posts a Discord-style `{content}` to the
 * configured webhook. Any failure is logged and swallowed — issue mint/update
 * must never depend on the ops channel being reachable.
 */
async function postOpsPing(ctx: PluginContext, webhookUrl: string | undefined, content: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const res = await ctx.http.fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) ctx.logger.warn("ops webhook ping failed", { status: res.status });
  } catch (err) {
    ctx.logger.warn("ops webhook ping error", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * First firing of a fingerprint: mint the issue (routed + assigned), then record
 * the mapping. We create the issue first and only persist the mapping after — a
 * failed insert leaves an orphan issue (visible, recoverable) rather than a
 * mapping pointing at an issue that was never created.
 */
async function mintIssue(ctx: PluginContext, cfg: KeepAlertsConfig, alert: KeepAlert, nowIso: string): Promise<void> {
  const routing = resolveOwnership(alert, cfg.ownership);
  const assigneeAgentId = routing.assigneeAgentId ?? cfg.defaultAssigneeAgentId;
  const projectId = routing.projectId ?? cfg.projectId;
  if (!projectId) {
    ctx.logger.error("keep-alert: no projectId (default or routed) — cannot mint", { fingerprint: alert.fingerprint });
    return;
  }

  const issue = await ctx.issues.create({
    companyId: cfg.companyId!,
    projectId,
    title: `[alert] ${alert.name}`,
    description: buildIssueDescription(alert),
    status: "todo",
    priority: severityToPriority(alert.severity),
    ...(assigneeAgentId ? { assigneeAgentId } : {}),
  });

  await insertNew(ctx.db, {
    fingerprint: alert.fingerprint,
    paperclipIssueId: issue.id,
    alertName: alert.name,
    severity: alert.severity,
    state: "open",
    fireCount: 1,
    firstSeenAt: nowIso,
    lastFiredAt: nowIso,
  });

  ctx.logger.info("keep-alert: minted Paperclip issue", {
    fingerprint: alert.fingerprint,
    issueId: issue.id,
    projectId,
    assigneeAgentId: assigneeAgentId ?? null,
    matchedBy: routing.matchedBy ?? null,
  });
  if (!assigneeAgentId) {
    ctx.logger.warn("keep-alert: minted issue UNASSIGNED — set defaultAssigneeAgentId or an ownership rule", {
      fingerprint: alert.fingerprint,
      issueId: issue.id,
    });
  }

  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildOpsPing({
      kind: "created",
      name: alert.name,
      severity: alert.severity,
      fingerprint: alert.fingerprint,
      issueId: issue.id,
      assigneeAgentId,
      matchedBy: routing.matchedBy,
    }),
  );
}

/** A firing alert whose fingerprint already has a mapping: re-fire or recurrence. */
async function handleFiringExisting(
  ctx: PluginContext,
  cfg: KeepAlertsConfig,
  alert: KeepAlert,
  nowIso: string,
  existing: { paperclipIssueId: string; state: string; fireCount: number },
): Promise<void> {
  const occurrence = existing.fireCount + 1;
  const recurred = existing.state === "resolved";

  if (recurred) {
    // Flap: the alert fired again after we closed the issue. Reopen + comment so
    // the history stays on one issue rather than spawning a duplicate.
    await ctx.issues.update(existing.paperclipIssueId, { status: "todo" }, cfg.companyId!);
    await ctx.issues.createComment(existing.paperclipIssueId, buildRecurrenceComment(alert, occurrence), cfg.companyId!);
  } else {
    await ctx.issues.createComment(existing.paperclipIssueId, buildRefireComment(alert, occurrence), cfg.companyId!);
  }

  await updateState(ctx.db, alert.fingerprint, {
    state: "open",
    fireCount: occurrence,
    severity: alert.severity,
    lastFiredAt: nowIso,
  });

  ctx.logger.info("keep-alert: updated existing issue", {
    fingerprint: alert.fingerprint,
    issueId: existing.paperclipIssueId,
    occurrence,
    kind: recurred ? "recurred" : "refired",
  });
  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildOpsPing({
      kind: recurred ? "recurred" : "refired",
      name: alert.name,
      severity: alert.severity,
      fingerprint: alert.fingerprint,
      issueId: existing.paperclipIssueId,
    }),
  );
}

/** A Keep resolution: close the fingerprint's issue with a comment (idempotent). */
async function handleResolution(ctx: PluginContext, cfg: KeepAlertsConfig, alert: KeepAlert, nowIso: string): Promise<void> {
  const existing = await getByFingerprint(ctx.db, alert.fingerprint);
  if (!existing) {
    // Resolution for an alert we never minted (e.g. below the severity gate).
    // Nothing to close — Discord already carried it.
    ctx.logger.info("keep-alert: resolution for unmapped fingerprint; ignoring", { fingerprint: alert.fingerprint });
    return;
  }
  if (existing.state === "resolved") {
    ctx.logger.info("keep-alert: already resolved; skipping", { fingerprint: alert.fingerprint });
    return;
  }

  await ctx.issues.createComment(existing.paperclipIssueId, buildResolutionComment(alert, existing.fireCount), cfg.companyId!);
  await ctx.issues.update(existing.paperclipIssueId, { status: "done" }, cfg.companyId!);
  await updateState(ctx.db, alert.fingerprint, {
    state: "resolved",
    fireCount: existing.fireCount,
    severity: existing.severity || alert.severity,
    lastFiredAt: nowIso,
  });

  ctx.logger.info("keep-alert: resolved + closed issue", {
    fingerprint: alert.fingerprint,
    issueId: existing.paperclipIssueId,
  });
  await postOpsPing(
    ctx,
    cfg.opsWebhookUrl,
    buildOpsPing({
      kind: "resolved",
      name: alert.name,
      severity: alert.severity,
      fingerprint: alert.fingerprint,
      issueId: existing.paperclipIssueId,
    }),
  );
}

/** Verify HMAC, parse, then dispatch on resolved / firing + severity gate. */
async function handleKeepAlert(ctx: PluginContext, cfg: KeepAlertsConfig, input: PluginWebhookInput): Promise<void> {
  if (!cfg.keepWebhookSecret) {
    ctx.logger.error("keep-alert: no keepWebhookSecret configured — rejecting");
    return;
  }
  if (!verifyKeepSignature(input.rawBody, cfg.keepWebhookSecret, getHeader(input.headers, "x-hub-signature-256"))) {
    ctx.logger.warn("keep-alert: signature verification failed");
    return;
  }
  if (!cfg.companyId) {
    ctx.logger.error("keep-alert: companyId not configured — cannot create/update issues");
    return;
  }

  const alert = parseKeepAlert(input.parsedBody ?? safeJson(input.rawBody));
  if (!alert) {
    ctx.logger.warn("keep-alert: unparseable/invalid payload (needs fingerprint + name)");
    return;
  }

  const nowIso = new Date().toISOString();

  // Resolution path: close whatever we already minted (or no-op if nothing).
  if (alert.resolved) {
    await handleResolution(ctx, cfg, alert, nowIso);
    return;
  }

  // Firing path. Severity gate: below the gate stays Discord-only.
  if (!shouldMint(alert.severity, cfg.mintSeverities)) {
    ctx.logger.info("keep-alert: below mint gate; Discord-only", {
      fingerprint: alert.fingerprint,
      severity: alert.severity,
    });
    await postOpsPing(
      ctx,
      cfg.opsWebhookUrl,
      buildOpsPing({
        kind: "skipped",
        name: alert.name,
        severity: alert.severity,
        fingerprint: alert.fingerprint,
        reason: `severity not in [${cfg.mintSeverities.join(", ")}]`,
      }),
    );
    return;
  }

  const existing = await getByFingerprint(ctx.db, alert.fingerprint);
  if (!existing) {
    await mintIssue(ctx, cfg, alert, nowIso);
  } else {
    await handleFiringExisting(ctx, cfg, alert, nowIso, existing);
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Keep Alerts plugin starting");
    // Capture ctx for onWebhook (the inbound handler only receives `input`).
    currentContext = ctx;

    const cfg = readConfig(await ctx.config.get());
    if (!cfg.companyId || !cfg.projectId || !cfg.keepWebhookSecret) {
      ctx.logger.warn(
        "keep-alerts INACTIVE until configured — set companyId, projectId and keepWebhookSecret. The plugin will reject inbound webhooks until then.",
      );
    }
    // The keep_alert_mapping table is created by migrations/001_init.sql, applied
    // by the host before worker init — runtime DDL is not permitted by ctx.db.
    ctx.logger.info("keep-alerts listening", {
      mintSeverities: cfg.mintSeverities,
      ownershipRules: cfg.ownership.length,
      opsWebhook: Boolean(cfg.opsWebhookUrl),
    });
  },

  /**
   * Inbound leg (Keep → Paperclip). The host routes the public endpoint
   * `POST …/webhooks/keep-alert` here. We verify the HMAC (the plugin's
   * responsibility) then mint/update the issue directly — routines can't, since
   * every routine run needs an agent.
   */
  async onWebhook(input: PluginWebhookInput): Promise<void> {
    const ctx = currentContext;
    if (!ctx) return;
    const cfg = readConfig(await ctx.config.get());
    try {
      if (input.endpointKey === KEEP_ENDPOINT_KEY) {
        await handleKeepAlert(ctx, cfg, input);
      } else {
        ctx.logger.warn("keep-alert: unknown endpoint", { endpointKey: input.endpointKey });
      }
    } catch (err) {
      ctx.logger.error("keep-alert: handler failed", {
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
