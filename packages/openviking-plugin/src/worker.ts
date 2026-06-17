import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult } from "@paperclipai/plugin-sdk";
import { VikingClient } from "./viking-client.js";
import { handleRemember } from "./tools/remember.js";
import { handleRecall } from "./tools/recall.js";
import { handleFind } from "./tools/find.js";
import { handleAbstract } from "./tools/abstract.js";
import { handleMemoryStats } from "./data/memory-stats.js";
import { runVaultIngest } from "./ingest/job.js";
import { readVault } from "./ingest/vault-reader.js";

/** Map a handler's domain result onto the SDK ToolResult contract. */
function toToolResult(out: Record<string, unknown>): ToolResult {
  if (typeof out.error === "string") return { error: out.error };
  return { data: out };
}

interface VikingConfig {
  /** The OpenViking API key itself, stored as a plain config value (see manifest). */
  apiKey: string;
  endpoint: string;
  account: string;
  user: string;
  vaultServerUrl: string;
}

function readConfig(raw: Record<string, unknown>): VikingConfig {
  return {
    apiKey: String(raw.apiKey ?? ""),
    endpoint: String(raw.endpoint ?? "http://openviking:1933"),
    account: String(raw.account ?? "agenticos"),
    user: String(raw.user ?? "deploy"),
    vaultServerUrl: String(raw.vaultServerUrl ?? "http://vault-server:7777"),
  };
}

/**
 * Build a VikingClient from the current plugin config, read at call time so
 * config edits take effect without a worker restart. The API key is a plain
 * config value (Paperclip's plugin secret-resolution path is disabled in
 * 2026.609.0 — see manifest).
 */
async function build(ctx: PluginContext): Promise<VikingClient> {
  const cfg = readConfig(await ctx.config.get());
  if (!cfg.apiKey) {
    throw new Error("OpenViking API key not configured — set it in the plugin settings");
  }
  return new VikingClient({
    baseUrl: cfg.endpoint,
    apiKey: cfg.apiKey,
    account: cfg.account,
    user: cfg.user,
    readTimeoutMs: 5000,
    writeTimeoutMs: 10000,
  });
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("OpenViking plugin starting");

    // --- Tools (read-write agent memory) ---

    ctx.tools.register(
      "viking_remember",
      {
        displayName: "Remember",
        description: "Store a memory in the agent's semantic memory (OpenViking)",
        parametersSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Memory content to store" },
            category: { type: "string", description: "Category (e.g. farm-ops, dev, content)" },
            tags: { type: "array", items: { type: "string" }, description: "Tags for retrieval" },
          },
          required: ["text"],
        },
      },
      async (params) =>
        toToolResult(
          await handleRemember(
            await build(ctx),
            params as { text: string; category?: string; tags?: string[] },
          ),
        ),
    );

    ctx.tools.register(
      "viking_recall",
      {
        displayName: "Recall",
        description: "Search agent memory by meaning (semantic retrieval)",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to search for" },
            limit: { type: "number", description: "Max results (default: 10)" },
            category: { type: "string", description: "Filter by category" },
          },
          required: ["query"],
        },
      },
      async (params) =>
        toToolResult(
          await handleRecall(
            await build(ctx),
            params as { query: string; limit?: number; category?: string },
          ),
        ),
    );

    ctx.tools.register(
      "viking_find",
      {
        displayName: "Find",
        description: "Browse agent memories by directory path (structured lookup)",
        parametersSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "viking:// URI path to browse" },
          },
          required: ["path"],
        },
      },
      async (params) => toToolResult(await handleFind(await build(ctx), params as { path: string })),
    );

    ctx.tools.register(
      "viking_abstract",
      {
        displayName: "Abstract",
        description: "Summarize/compress a set of memories into a higher-level abstraction",
        parametersSchema: {
          type: "object",
          properties: {
            memoryIds: { type: "array", items: { type: "string" }, description: "Memory IDs to compress" },
          },
          required: ["memoryIds"],
        },
      },
      async (params) =>
        toToolResult(await handleAbstract(await build(ctx), params as { memoryIds: string[] })),
    );

    // --- Data providers ---

    ctx.data.register("memory-stats", async () => handleMemoryStats(await build(ctx)));

    // --- Scheduled job: hourly vault → OpenViking resource ingest ---

    ctx.jobs.register("vault-ingest", async () => {
      const cfg = readConfig(await ctx.config.get());
      const viking = await build(ctx);
      const summary = await runVaultIngest({
        reader: (url) => readVault(url),
        viking,
        db: ctx.db,
        vaultServerUrl: cfg.vaultServerUrl,
      });
      ctx.logger.info("vault-ingest complete", summary as unknown as Record<string, unknown>);
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
