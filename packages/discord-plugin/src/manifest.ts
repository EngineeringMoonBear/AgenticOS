import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.discord-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Discord Receipts",
  description:
    "Polls #receipts for receipt photos, archives them to Spaces, files issues for Penny (CFO), and DMs the weekly attach digest.",
  author: "AgenticOS",
  categories: ["connector"],
  capabilities: [
    "jobs.schedule",
    "http.outbound",
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "issue.comments.read",
    "plugin.state.read",
    "plugin.state.write",
    "agent.tools.register",
  ],
  jobs: [
    {
      jobKey: "receipt-ingest",
      displayName: "Receipt Ingest",
      description: "Poll #receipts for new images, archive to Spaces, file issues for Penny",
      schedule: "*/10 * * * *",
    },
    {
      jobKey: "weekly-digest",
      displayName: "Weekly Attach Digest",
      description: "DM Josh the in_review receipts ready for the FarmRaise attach pass",
      schedule: "0 22 * * 0", // Sunday 22:00 UTC = 6pm ET (DST). Server runs UTC.
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      discordBotToken: {
        type: "string",
        title: "Discord Bot Token",
        description: "Bot token. Set via scripts/sync-paperclip-secrets.sh, not by hand.",
      },
      receiptsChannelId: { type: "string", title: "#receipts Channel ID" },
      companyId: { type: "string", title: "Paperclip Company ID (Goldberry Grove)" },
      pennyAgentId: { type: "string", title: "Penny's Agent ID" },
      joshDiscordUserId: { type: "string", title: "Josh's Discord User ID (digest DM target)" },
      spacesKey: { type: "string", title: "DO Spaces Access Key" },
      spacesSecret: { type: "string", title: "DO Spaces Secret" },
      spacesBucket: { type: "string", title: "Spaces Bucket", default: "agenticos-receipts" },
      spacesRegion: { type: "string", title: "Spaces Region", default: "nyc3" },
      spacesEndpoint: {
        type: "string",
        title: "Spaces Endpoint",
        default: "https://nyc3.digitaloceanspaces.com",
      },
      presignExpirySeconds: {
        type: "number",
        title: "Presigned URL expiry (seconds)",
        default: 604800,
      },
    },
    required: [
      "discordBotToken",
      "receiptsChannelId",
      "companyId",
      "pennyAgentId",
      "joshDiscordUserId",
      "spacesKey",
      "spacesSecret",
    ],
  },
  entrypoints: { worker: "./dist/worker.js" },
};

export default manifest;
