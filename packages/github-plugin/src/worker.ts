import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext, ToolResult } from "@paperclipai/plugin-sdk";
import { GitHubClient } from "./github-client.js";
import { VaultWriter } from "./vault-writer.js";
import { runPrTriage } from "./job.js";

interface GithubConfig {
  /** The GitHub token itself, stored as a plain config value (see manifest). */
  githubToken: string;
  org: string;
  staleDays: number;
  vaultPath: string;
  vaultServerUrl: string;
}

function readConfig(raw: Record<string, unknown>): GithubConfig {
  return {
    githubToken: String(raw.githubToken ?? ""),
    org: String(raw.org ?? "EngineeringMoonBear"),
    staleDays: Number(raw.staleDays ?? 7),
    vaultPath: String(raw.vaultPath ?? "wiki/_meta/dev-pr-digest.md"),
    vaultServerUrl: String(raw.vaultServerUrl ?? "http://vault-server:7777"),
  };
}

/**
 * Build a GitHubClient + VaultWriter from the current plugin config, read at
 * call time so config edits take effect without a worker restart. The token is
 * a plain config value (Paperclip's plugin secret-resolution path is disabled
 * in 2026.609.0 — see manifest).
 */
async function build(ctx: PluginContext): Promise<{
  client: GitHubClient;
  writer: VaultWriter;
  cfg: GithubConfig;
}> {
  const cfg = readConfig(await ctx.config.get());
  if (!cfg.githubToken) {
    throw new Error("GitHub token not configured — set it in the plugin settings");
  }
  return {
    client: new GitHubClient({ token: cfg.githubToken, org: cfg.org, timeoutMs: 15000 }),
    writer: new VaultWriter({ baseUrl: cfg.vaultServerUrl, timeoutMs: 10000 }),
    cfg,
  };
}

function ok(data: unknown): ToolResult {
  return { data };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("GitHub plugin starting");

    // --- Read-only tools (for on-demand Dev Agent use) ---

    ctx.tools.register(
      "github_list_prs",
      {
        displayName: "List Open PRs",
        description: "List all open PRs across the org",
        parametersSchema: { type: "object", properties: {} },
      },
      async () => {
        const { client } = await build(ctx);
        const res = await client.searchOpenPrs();
        return res.ok ? ok(res.data) : { error: res.error };
      },
    );

    ctx.tools.register(
      "github_pr_detail",
      {
        displayName: "PR Detail",
        description: "Get mergeable state and head SHA for a specific PR",
        parametersSchema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            number: { type: "number" },
          },
          required: ["repo", "number"],
        },
      },
      async (params) => {
        const { repo, number } = params as { repo: string; number: number };
        const { client } = await build(ctx);
        const res = await client.prDetail(repo, number);
        return res.ok ? ok(res.data) : { error: res.error };
      },
    );

    ctx.tools.register(
      "github_pr_checks",
      {
        displayName: "PR Checks State",
        description: "Get the rollup checks state for a PR head SHA",
        parametersSchema: {
          type: "object",
          properties: {
            repo: { type: "string" },
            headSha: { type: "string" },
          },
          required: ["repo", "headSha"],
        },
      },
      async (params) => {
        const { repo, headSha } = params as { repo: string; headSha: string };
        const { client } = await build(ctx);
        const res = await client.prChecksState(repo, headSha);
        return res.ok ? ok(res.data) : { error: res.error };
      },
    );

    // --- Scheduled job: daily PR triage digest ---

    ctx.jobs.register("pr-triage", async () => {
      const { client, writer, cfg } = await build(ctx);
      const summary = await runPrTriage({
        client,
        writer,
        now: new Date(),
        staleDays: cfg.staleDays,
        vaultPath: cfg.vaultPath,
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
