import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { ToolResult } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { VaultWriter } from "./vault-writer.js";
import { runPrTriage } from "./job.js";

const ORG = process.env.GITHUB_ORG ?? "EngineeringMoonBear";
const STALE_DAYS = Number(process.env.PR_TRIAGE_STALE_DAYS ?? "7");
const VAULT_PATH = process.env.PR_TRIAGE_VAULT_PATH ?? "wiki/_meta/dev-pr-digest.md";

function ok(data: unknown): ToolResult {
  return { data };
}

const plugin = definePlugin({
  async setup(ctx) {
    const client = new GitHubClient({
      token: process.env.GITHUB_TOKEN ?? "",
      org: ORG,
      timeoutMs: 15000,
    });
    const writer = new VaultWriter({
      baseUrl: process.env.VAULT_SERVER_URL ?? "http://vault-server:7777",
      timeoutMs: 10000,
    });

    ctx.logger.info("GitHub plugin starting", { org: ORG });

    // --- Read-only tools (for on-demand Dev Agent use) ---

    ctx.tools.register(
      "github_list_prs",
      {
        displayName: "List Open PRs",
        description: "List all open PRs across the org",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => {
        const res = await client.searchOpenPrs();
        return res.ok ? ok(res.data) : { error: res.error };
      },
    );

    // --- Scheduled job: daily PR triage digest ---

    ctx.jobs.register("pr-triage", async () => {
      if (!process.env.GITHUB_TOKEN) {
        throw new Error("GITHUB_TOKEN not set; cannot reach GitHub");
      }
      const summary = await runPrTriage({
        client,
        writer,
        now: new Date(),
        staleDays: STALE_DAYS,
        vaultPath: VAULT_PATH,
      });
      ctx.logger.info("pr-triage complete", summary as unknown as Record<string, unknown>);
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
