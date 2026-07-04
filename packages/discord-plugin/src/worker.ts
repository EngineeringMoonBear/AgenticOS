import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult } from "@paperclipai/plugin-sdk";
import type { DiscordPluginConfig } from "./types.js";
import { DiscordClient } from "./discord-client.js";
import { ReceiptArchive } from "./spaces.js";
import { runIngest } from "./ingest/job.js";
import { runDigest } from "./digest/job.js";
import {
  handleRecordExtraction,
  handleRequestRetake,
  handleDismiss,
  handleReply,
  type ToolDeps,
} from "./tools/index.js";

const ORIGIN_KIND = "plugin:agenticos.discord-plugin" as const;

/** Map a handler's domain result onto the SDK ToolResult contract. */
function toToolResult(out: Record<string, unknown>): ToolResult {
  if (typeof out.error === "string") return { error: out.error };
  return { data: out };
}

function readConfig(raw: Record<string, unknown>): DiscordPluginConfig {
  const required = [
    "discordBotToken", "receiptsChannelId", "companyId",
    "pennyAgentId", "joshDiscordUserId", "spacesKey", "spacesSecret",
  ] as const;
  for (const key of required) {
    if (typeof raw[key] !== "string" || raw[key] === "") throw new Error(`discord-plugin config missing: ${key}`);
  }
  return {
    discordBotToken: String(raw.discordBotToken),
    receiptsChannelId: String(raw.receiptsChannelId),
    companyId: String(raw.companyId),
    pennyAgentId: String(raw.pennyAgentId),
    joshDiscordUserId: String(raw.joshDiscordUserId),
    spacesKey: String(raw.spacesKey),
    spacesSecret: String(raw.spacesSecret),
    spacesBucket: String(raw.spacesBucket ?? "agenticos-receipts"),
    spacesRegion: String(raw.spacesRegion ?? "nyc3"),
    spacesEndpoint: String(raw.spacesEndpoint ?? "https://nyc3.digitaloceanspaces.com"),
    presignExpirySeconds: Number(raw.presignExpirySeconds ?? 604800),
  };
}

function buildToolDeps(ctx: PluginContext, cfg: DiscordPluginConfig, discord: DiscordClient, archive: ReceiptArchive): ToolDeps {
  return {
    issues: {
      getDescription: async (issueId) => (await ctx.issues.get(issueId, cfg.companyId))?.description ?? null,
      createComment: async (issueId, body) => {
        await ctx.issues.createComment(issueId, body, cfg.companyId, { authorAgentId: cfg.pennyAgentId });
      },
      setStatus: async (issueId, status) => {
        await ctx.issues.update(issueId, { status }, cfg.companyId);
      },
    },
    discord: {
      replyToMessage: (c, m, text) => discord.replyToMessage(c, m, text),
      react: (c, m, e) => discord.react(c, m, e),
    },
    archive: {
      putJson: (key, value) =>
        archive.put(key, new TextEncoder().encode(JSON.stringify(value, null, 2)), "application/json"),
    },
    log: (msg) => ctx.logger.info(msg),
  };
}

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    issueId: { type: "string", description: "The receipt issue id you are working on" },
    extraction: {
      type: "object",
      properties: {
        vendor: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD as printed on the receipt" },
        total: { type: "number" },
        payment_method: { type: "string", enum: ["card", "cash", "check", "unknown"] },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: { description: { type: "string" }, amount: { type: "number" } },
            required: ["description", "amount"],
          },
        },
        suggested_category: { type: "string", description: "Schedule F or custom category" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        flags: { type: "array", items: { type: "string" } },
      },
      required: ["vendor", "date", "total", "payment_method", "suggested_category", "confidence", "flags", "line_items"],
    },
  },
  required: ["issueId", "extraction"],
} as const;

const plugin = definePlugin({
  async setup(ctx) {
    const cfg = readConfig(await ctx.config.get());
    const discord = new DiscordClient({ token: cfg.discordBotToken });
    const archive = ReceiptArchive.fromConfig(cfg);
    const toolDeps = buildToolDeps(ctx, cfg, discord, archive);
    const cursorKey = { scopeKind: "instance" as const, stateKey: "receipts-cursor" };

    ctx.jobs.register("receipt-ingest", async () => {
      const summary = await runIngest({
        discord,
        archive,
        issues: {
          existsByOrigin: async (originId) => {
            const hits = await ctx.issues.list({
              companyId: cfg.companyId,
              originKind: ORIGIN_KIND,
              originId,
              limit: 1,
            });
            return hits.length > 0;
          },
          createReceiptIssue: async ({ title, description, originId }) => {
            const issue = await ctx.issues.create({
              companyId: cfg.companyId,
              title,
              description,
              status: "todo",
              priority: "medium",
              assigneeAgentId: cfg.pennyAgentId,
              originKind: ORIGIN_KIND,
              originId,
            });
            return { id: issue.id };
          },
        },
        state: {
          getCursor: async () => (await ctx.state.get(cursorKey)) as string | null,
          setCursor: (id) => ctx.state.set(cursorKey, id),
        },
        config: cfg,
        log: (msg) => ctx.logger.info(msg),
      });
      ctx.logger.info("receipt-ingest complete", summary as unknown as Record<string, unknown>);
    });

    ctx.jobs.register("weekly-digest", async () => {
      const summary = await runDigest({
        issues: {
          listInReview: async () => {
            const issues = await ctx.issues.list({
              companyId: cfg.companyId,
              originKindPrefix: "plugin:agenticos.discord-plugin",
              status: "in_review",
              limit: 100,
            });
            return issues.map((i) => ({ id: i.id, title: i.title, description: i.description ?? "" }));
          },
          listComments: async (issueId) =>
            (await ctx.issues.listComments(issueId, cfg.companyId)).map((c) => c.body),
        },
        discord,
        archive,
        config: cfg,
        log: (msg) => ctx.logger.info(msg),
      });
      ctx.logger.info("weekly-digest complete", summary as unknown as Record<string, unknown>);
    });

    ctx.tools.register(
      "receipt_record_extraction",
      {
        displayName: "Record receipt extraction",
        description:
          "Record your extraction for a receipt issue: writes the Spaces sidecar, posts the extraction comment, replies in the Discord thread, and stages the issue for Josh's review (in_review). Call exactly once per receipt after reading the image.",
        parametersSchema: EXTRACTION_SCHEMA,
      },
      async (params) => toToolResult(await handleRecordExtraction(toolDeps, params)),
    );

    ctx.tools.register(
      "receipt_request_retake",
      {
        displayName: "Request receipt retake",
        description: "Ask the poster for a better photo when the receipt is unreadable (confidence < 0.7). Blocks the issue.",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, reason: { type: "string" } },
          required: ["issueId", "reason"],
        },
      },
      async (params) => toToolResult(await handleRequestRetake(toolDeps, params)),
    );

    ctx.tools.register(
      "receipt_dismiss",
      {
        displayName: "Dismiss non-receipt",
        description: "Dismiss an image that is not a receipt (reacts 🤷 on Discord, cancels the issue).",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, reason: { type: "string" } },
          required: ["issueId", "reason"],
        },
      },
      async (params) => toToolResult(await handleDismiss(toolDeps, params)),
    );

    ctx.tools.register(
      "discord_reply",
      {
        displayName: "Reply in receipt thread",
        description: "Free-form reply in the Discord thread of a receipt issue (e.g. to ask the poster a question).",
        parametersSchema: {
          type: "object",
          properties: { issueId: { type: "string" }, message: { type: "string" } },
          required: ["issueId", "message"],
        },
      },
      async (params) => toToolResult(await handleReply(toolDeps, params)),
    );

    ctx.data.register("discord-health", async () => ({ status: "ok", channel: cfg.receiptsChannelId }));
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
