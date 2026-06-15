import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolResult } from "@paperclipai/plugin-sdk";
import { VaultClient } from "./vault-client.js";
import { handleSearch } from "./tools/search.js";
import { handleRead } from "./tools/read.js";
import { handleList } from "./tools/list.js";
import { handleStats } from "./tools/stats.js";
import { handleDiscard } from "./actions/discard.js";

/** Map a handler's domain result onto the SDK ToolResult contract. */
function toToolResult(out: Record<string, unknown>): ToolResult {
  if (typeof out.error === "string") return { error: out.error };
  return { data: out };
}

const plugin = definePlugin({
  async setup(ctx) {
    const cfg = await ctx.config.get();
    const baseUrl = String(cfg.vaultServerUrl ?? "http://vault-server:7777");
    const client = new VaultClient({ baseUrl, timeoutMs: 5000 });

    ctx.logger.info("Vault plugin starting", { vaultServerUrl: baseUrl });

    // --- Tools (read-only access to vault content) ---

    ctx.tools.register(
      "vault_search",
      {
        displayName: "Vault Search",
        description: "Search the Obsidian vault for pages matching a query",
        parametersSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Max results (default: 10)" },
          },
          required: ["query"],
        },
      },
      async (params) =>
        toToolResult(
          await handleSearch(client, params as { query: string; limit?: number }),
        ),
    );

    ctx.tools.register(
      "vault_read",
      {
        displayName: "Vault Read",
        description: "Read a specific page from the vault by path",
        parametersSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Page path (e.g. wiki/Software/AgenticOS.md)" },
          },
          required: ["path"],
        },
      },
      async (params) => toToolResult(await handleRead(client, params as { path: string })),
    );

    ctx.tools.register(
      "vault_list",
      {
        displayName: "Vault List",
        description: "List all pages in the vault with their paths",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => toToolResult(await handleList(client)),
    );

    ctx.tools.register(
      "vault_stats",
      {
        displayName: "Vault Stats",
        description: "Get vault statistics (page count, categories)",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => toToolResult(await handleStats(client)),
    );

    // --- Actions (the ONLY write path: inbox archival) ---

    ctx.actions.register("vault_discard", async (params) => {
      const path = String(params.path ?? "");
      if (!path) throw new Error("path is required");
      return handleDiscard(client, { path });
    });

    // --- Data providers ---

    ctx.data.register("vault-health", async () => {
      const stats = await client.getStats();
      if (!stats.ok) return { status: "unreachable", error: stats.error };
      const inbox = await client.getInbox();
      return {
        status: "ok",
        pageCount: stats.data.pageCount,
        inboxCount: inbox.ok ? inbox.data.items.length : 0,
      };
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
