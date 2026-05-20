import { describe, expect, it } from "vitest";
import { MCP_VAULT_TOOLS } from "./tools";

describe("MCP vault tool registry", () => {
  it("contains exactly 11 tools", () => {
    expect(MCP_VAULT_TOOLS).toHaveLength(11);
  });

  it("each tool has a unique name", () => {
    const names = MCP_VAULT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("each tool has a valid proxy target", () => {
    for (const tool of MCP_VAULT_TOOLS) {
      expect(["GET", "POST"]).toContain(tool.proxyTo.method);
      expect(tool.proxyTo.path).toMatch(/^\/api\//);
    }
  });

  it("the 9 Curator-whitelisted tools are all present", () => {
    const allowed = [
      "vault.page.read", "vault.tree.list", "vault.search", "vault.backlinks",
      "vault.inbox.list", "vault.inbox.item", "vault.inbox.commit",
      "vault.inbox.discard", "lint.run",
    ];
    for (const name of allowed) {
      expect(MCP_VAULT_TOOLS.find((t) => t.name === name)).toBeDefined();
    }
  });
});
