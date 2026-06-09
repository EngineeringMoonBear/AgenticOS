import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { VikingClient } from "./viking-client.js";
import { handleRemember } from "./tools/remember.js";
import { handleRecall } from "./tools/recall.js";
import { handleFind } from "./tools/find.js";
import { handleAbstract } from "./tools/abstract.js";
import { handleMemoryStats } from "./data/memory-stats.js";

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

    ctx.tools.register("viking_remember", {
      description: "Store a memory in the agent's semantic memory (OpenViking)",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Memory content to store" },
          category: { type: "string", description: "Category (e.g. farm-ops, dev, content)" },
          tags: { type: "array", items: { type: "string" }, description: "Tags for retrieval" },
        },
        required: ["text"],
      },
      handler: async (input) =>
        handleRemember(client, input as { text: string; category?: string; tags?: string[] }),
    });

    ctx.tools.register("viking_recall", {
      description: "Search agent memory by meaning (semantic retrieval)",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for" },
          limit: { type: "number", description: "Max results (default: 10)" },
          category: { type: "string", description: "Filter by category" },
        },
        required: ["query"],
      },
      handler: async (input) =>
        handleRecall(client, input as { query: string; limit?: number; category?: string }),
    });

    ctx.tools.register("viking_find", {
      description: "Browse agent memories by directory path (structured lookup)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "viking:// URI path to browse" },
        },
        required: ["path"],
      },
      handler: async (input) => handleFind(client, input as { path: string }),
    });

    ctx.tools.register("viking_abstract", {
      description: "Summarize/compress a set of memories into a higher-level abstraction",
      parameters: {
        type: "object",
        properties: {
          memoryIds: { type: "array", items: { type: "string" }, description: "Memory IDs to compress" },
        },
        required: ["memoryIds"],
      },
      handler: async (input) =>
        handleAbstract(client, input as { memoryIds: string[] }),
    });

    // --- Data providers ---

    ctx.data.register("memory-stats", async () => handleMemoryStats(client));
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
