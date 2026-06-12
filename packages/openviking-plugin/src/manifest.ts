import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.openviking-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "OpenViking Memory",
  description:
    "Agent semantic memory — remember, recall, find, and abstract",
  author: "AgenticOS",
  categories: ["connector"],
  // Schema requires >=1 capability; the worker's clients do outbound HTTP
  // to OpenViking, which is what this grants.
  capabilities: ["http.outbound"],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
