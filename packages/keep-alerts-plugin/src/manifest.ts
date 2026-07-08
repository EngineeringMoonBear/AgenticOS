import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

/**
 * Keep Alerts → Paperclip issues (GOL-91).
 *
 * Every alert path in the fleet (Keep→Discord, OpenObserve alerts.json, odoocker
 * workflow notifiers via discord-status.sh) previously terminated at Discord;
 * nothing minted a trackable issue. This plugin taps **Keep** — which already
 * owns dedup/fingerprints/severity — and mints one Paperclip issue per alert
 * fingerprint. Re-fires comment on the existing issue (never duplicate); a Keep
 * resolution posts a closing comment and closes the issue.
 *
 * Contract reuse: this is the github-sync-plugin inbound leg with an alert shape.
 * HMAC-verified public webhook + agent-free `ctx.issues.create`. The Keep action
 * signs the body (X-Hub-Signature-256) and rides the existing Cloudflare Access
 * service-token path to reach the public endpoint.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.keep-alerts-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Keep Alerts → Issues",
  description:
    "Mint Paperclip issues from Keep alerts, keyed by alert fingerprint. Critical/warning alerts mint issues (info stays Discord-only); re-fires comment on the existing issue, Keep resolutions close it. Routes each issue by a per-source ownership map (infra → DevOps agent).",
  author: "AgenticOS",
  categories: ["connector"],
  // issues.create + webhooks.receive: the inbound leg. The host exposes a public
  //   (board-auth-free) endpoint POST /api/plugins/:id/webhooks/keep-alert for the
  //   Keep workflow action; onWebhook verifies the HMAC and creates/updates the
  //   issue directly (routines can't — every routine run needs an agent).
  // issues.update: close the issue on Keep resolution, reopen on recurrence.
  // issue.comments.create: re-fires, recurrences and resolutions post a comment
  //   on the fingerprint's existing issue rather than duplicating.
  // http.outbound: optional best-effort Discord ops ping (parity with existing notifiers).
  // database.namespace.{read,write,migrate}: the keep_alert_mapping table
  //   (fingerprint → issue + lifecycle) in the plugin DB namespace. Created by
  //   migrations/001_init.sql (runtime DDL via ctx.db.execute is forbidden).
  capabilities: [
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "webhooks.receive",
    "http.outbound",
    "database.namespace.read",
    "database.namespace.write",
    "database.namespace.migrate",
  ],
  webhooks: [
    {
      endpointKey: "keep-alert",
      displayName: "Keep alert → Paperclip issue (fingerprint-keyed)",
      description:
        "Receives a Keep alert payload (HMAC-signed with keepWebhookSecret via X-Hub-Signature-256). Mints a Paperclip issue on first firing of a fingerprint, comments on re-fires, and closes it on resolution. Add a Keep workflow action POSTing here on alert firing/resolution.",
    },
  ],
  // Declaring `database` is REQUIRED for the host to provision + activate the
  // plugin's Postgres namespace. migrationsDir → migrations/001_init.sql creates
  // the keep_alert_mapping table (runtime DDL is forbidden, so it MUST come from
  // a migration).
  database: {
    namespaceSlug: "keep_alerts",
    migrationsDir: "migrations",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      companyId: {
        type: "string",
        title: "Company ID",
        description:
          "UUID of the company that owns the alert-issues project. Required — the public webhook has no actor, so ctx.issues.create needs the company explicitly.",
      },
      projectId: {
        type: "string",
        title: "Default project ID",
        description:
          "Project where alert issues are minted when no ownership rule overrides it. Typically an Ops/Infra project.",
      },
      keepWebhookSecret: {
        type: "string",
        format: "secret-ref",
        title: "Keep webhook HMAC secret",
        description:
          "Shared secret the Keep workflow action signs the payload with (X-Hub-Signature-256: sha256=<hex> over the raw body). Set the SAME value in the Keep action's signing config.",
      },
      defaultAssigneeAgentId: {
        type: "string",
        title: "Default assignee agent ID",
        description:
          "Agent UUID that minted alert issues are assigned to when no ownership rule matches. REQUIRED to close the auto-pickup loop — Paperclip agents never pick up unassigned work, so an unassigned alert issue sits unowned forever. Set to the general Ops/DevOps owner.",
      },
      mintSeverities: {
        type: "array",
        title: "Severities that mint issues",
        description:
          "Keep severities that create/track a Paperclip issue. Anything not listed stays Discord-only. Defaults to [\"critical\",\"high\",\"warning\"] (info and low are Discord-only).",
        items: { type: "string", enum: ["critical", "high", "warning", "info", "low"] },
      },
      ownership: {
        type: "array",
        title: "Ownership routing rules (per-source map, D2)",
        description:
          "Ordered rules routing an alert to an owner. The first rule whose `match` appears (case-insensitive substring) in the alert's source/service/environment/name/labels wins. E.g. { match: \"infra\", assigneeAgentId: \"<devops-agent-uuid>\" } sends infra alerts to the DevOps agent queue.",
        items: {
          type: "object",
          properties: {
            match: {
              type: "string",
              title: "Match token",
              description: "Substring tested against the alert's routing tokens (source, service, environment, name, label key=value).",
            },
            assigneeAgentId: {
              type: "string",
              title: "Assignee agent ID",
              description: "Agent UUID that alerts matching this rule are assigned to.",
            },
            projectId: {
              type: "string",
              title: "Project ID (optional override)",
              description: "Mint matching alerts into this project instead of the default projectId.",
            },
          },
          required: ["match", "assigneeAgentId"],
        },
      },
      opsWebhookUrl: {
        type: "string",
        title: "Ops webhook URL (Discord)",
        description:
          "Optional Discord (or Discord-compatible) webhook. When set, the plugin posts a best-effort `{content}` ping on every mint/re-fire/resolution so alert triage is never silent. A failed ping never blocks issue creation.",
      },
    },
    required: ["companyId", "projectId", "keepWebhookSecret"],
  },
  // Inbound webhook only. No scheduled jobs, no event subscriptions.
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
