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
  // http.outbound: the worker's client calls the OpenViking HTTP API.
  // secrets.read-ref: resolve the configured API key (supplied by the operator
  // via plugin settings — Paperclip sandboxes workers away from host env).
  capabilities: ["http.outbound", "secrets.read-ref"],
  instanceConfigSchema: {
    type: "object",
    properties: {
      apiKey: {
        type: "string",
        format: "secret-ref",
        title: "OpenViking API Key",
        description:
          "Root API key for the OpenViking server. Paste the value here; it is stored as a secret.",
      },
      endpoint: {
        type: "string",
        title: "OpenViking Endpoint",
        description: "Internal URL of the OpenViking server.",
        default: "http://openviking:1933",
      },
      account: {
        type: "string",
        title: "Account",
        default: "agenticos",
      },
      user: {
        type: "string",
        title: "User",
        default: "deploy",
      },
    },
    required: ["apiKey"],
  },
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
