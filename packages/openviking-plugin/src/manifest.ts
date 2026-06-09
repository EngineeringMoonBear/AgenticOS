import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.openviking-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenViking Memory",
  description:
    "Agent semantic memory — remember, recall, find, and abstract",
  author: "AgenticOS",
  categories: ["memory", "integration"],
  capabilities: [],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
