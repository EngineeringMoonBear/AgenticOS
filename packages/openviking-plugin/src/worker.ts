import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolResult } from "@paperclipai/plugin-sdk";
import { VikingClient } from "./viking-client.js";
import { handleRemember } from "./tools/remember.js";
import { handleRecall } from "./tools/recall.js";
import { handleFind } from "./tools/find.js";
import { handleAbstract } from "./tools/abstract.js";
import { handleMemoryStats } from "./data/memory-stats.js";

/** Map a handler's domain result onto the SDK ToolResult contract. */
function toToolResult(out: Record<string, unknown>): ToolResult {
  if (typeof out.error === "string") return { error: out.error };
  return { data: out };
}

const plugin = definePlugin({
  async setup(ctx) {
    const client = new VikingClient({
      baseUrl: process.env.OPENVIKING_ENDPOINT ?? "http://openviking:1933",
      apiKey: process.env.OPENVIKING_ROOT_API_KEY ?? "",
      account: process.env.OPENVIKING_ACCOUNT ?? "agenticos",
      user: process.env.OPENVIKING_USER ?? "deploy",
      readTimeoutMs: 5000,
      writeTimeoutMs: 10000,
    });

    ctx.logger.info("OpenViking plugin starting", {
      endpoint: process.env.OPENVIKING_ENDPOINT ?? "http://openviking:1933",
      account: process.env.OPENVIKING_ACCOUNT ?? "agenticos",
    });

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
            client,
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
            client,
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
      async (params) => toToolResult(await handleFind(client, params as { path: string })),
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
        toToolResult(await handleAbstract(client, params as { memoryIds: string[] })),
    );

    // --- Data providers ---

    ctx.data.register("memory-stats", async () => handleMemoryStats(client));
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
