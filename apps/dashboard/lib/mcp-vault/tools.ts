import type { McpToolDef } from "./types";

export const MCP_VAULT_TOOLS: McpToolDef[] = [
  {
    name:        "vault.page.read",
    description: "Read a wiki page by path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/page", query: ["path"] },
  },
  {
    name:        "vault.tree.list",
    description: "List the wiki folder tree.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/vault/tree" },
  },
  {
    name:        "vault.search",
    description: "Full-text search across the vault.",
    inputSchema: {
      type: "object",
      properties: {
        q:     { type: "string" },
        tags:  { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["q"],
    },
    proxyTo: { method: "GET", path: "/api/vault/search", query: ["q", "tags", "limit"] },
  },
  {
    name:        "vault.backlinks",
    description: "List wiki pages that link to the given path.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/backlinks", query: ["path"] },
  },
  {
    name:        "vault.inbox.list",
    description: "List inbox items.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/vault/inbox" },
  },
  {
    name:        "vault.inbox.item",
    description: "Read a single inbox item.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "GET", path: "/api/vault/inbox/item", query: ["path"] },
  },
  {
    name:        "vault.inbox.promote",
    description: "Get an LLM-generated proposal for promoting an inbox item.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "POST", path: "/api/vault/inbox/promote" },
  },
  {
    name:        "vault.inbox.commit",
    description: "Atomically write a wiki page (or curator-log) and clear/archive the inbox item.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string" },
        title:       { type: "string" },
        tags:        { type: "array", items: { type: "string" } },
        body:        { type: "string" },
        inboxPath:   { type: "string" },
      },
      required: ["destination", "title", "body"],
    },
    proxyTo: { method: "POST", path: "/api/vault/inbox/commit" },
  },
  {
    name:        "vault.inbox.discard",
    description: "Move an inbox item to archived/.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    proxyTo:     { method: "POST", path: "/api/vault/inbox/discard" },
  },
  {
    name:        "lint.run",
    description: "Run vault lint and return all issues.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/lint" },
  },
  {
    name:        "taxonomy.list",
    description: "List the canonical tag taxonomy.",
    inputSchema: { type: "object", properties: {} },
    proxyTo:     { method: "GET", path: "/api/taxonomy" },
  },
];
