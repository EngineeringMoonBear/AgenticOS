import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { VaultClient } from "./vault-client.js";
import { handleSearch } from "./tools/search.js";
import { handleRead } from "./tools/read.js";
import { handleList } from "./tools/list.js";
import { handleStats } from "./tools/stats.js";
import { handleDiscard } from "./actions/discard.js";

const plugin = definePlugin({
  async setup(ctx) {
    const client = new VaultClient({
      baseUrl: process.env.VAULT_SERVER_URL ?? "http://vault-server:7777",
      timeoutMs: 5000,
    });

    ctx.logger.info("Vault plugin starting", {
      vaultServerUrl: process.env.VAULT_SERVER_URL ?? "http://vault-server:7777",
    });

    // --- Tools (read-only access to vault content) ---

    ctx.tools.register("vault_search", {
      description: "Search the Obsidian vault for pages matching a query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 10)" },
        },
        required: ["query"],
      },
      handler: async (input) => handleSearch(client, input as { query: string; limit?: number }),
    });

    ctx.tools.register("vault_read", {
      description: "Read a specific page from the vault by path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Page path (e.g. wiki/Software/AgenticOS.md)" },
        },
        required: ["path"],
      },
      handler: async (input) => handleRead(client, input as { path: string }),
    });

    ctx.tools.register("vault_list", {
      description: "List all pages in the vault with their paths",
      parameters: { type: "object", properties: {} },
      handler: async () => handleList(client),
    });

    ctx.tools.register("vault_stats", {
      description: "Get vault statistics (page count, categories)",
      parameters: { type: "object", properties: {} },
      handler: async () => handleStats(client),
    });

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
