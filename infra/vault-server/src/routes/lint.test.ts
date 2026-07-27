import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerLintRoute } from "./lint.js";
import { resetStoreForTests } from "../lib/vault-store.js";
import type { Config } from "../config.js";

// Self-contained temp vault so we don't add a malformed note to the shared
// sample-vault fixture (which other route tests build their index from).
let tmpRoot: string;

function makeConfig(vaultRoot: string): Config {
  return {
    port: 7777,
    vaultRoot,
    syncthingUrl: undefined,
    syncthingApiKey: undefined,
    syncthingFolderId: "agenticos-vault",
  };
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(tmpRoot, "wiki", rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

const BAD =
  `---\ntitle: Helvetia Campaign — Bruno & Carlo: Cousin Connection\n` +
  `tags: [tabletop]\n---\nBody.`;

describe("GET /lint", () => {
  beforeEach(async () => {
    resetStoreForTests();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vault-lint-route-"));
    await fs.mkdir(path.join(tmpRoot, "wiki"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("returns a malformed-frontmatter issue for an unparseable note", async () => {
    await write("Good/One.md", "# One");
    await write("Bad/Broken.md", BAD);

    const app = Fastify();
    registerLintRoute(app, makeConfig(tmpRoot));

    const res = await app.inject({ method: "GET", url: "/lint" });
    expect(res.statusCode).toBe(200);

    const issues = res.json().issues as Array<{ kind: string; path: string }>;
    const malformed = issues.filter((i) => i.kind === "malformed-frontmatter");
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.path).toBe("Bad/Broken");

    await app.close();
  });

  it("returns an empty issue list for a clean vault", async () => {
    await write("Good/One.md", "# One");

    const app = Fastify();
    registerLintRoute(app, makeConfig(tmpRoot));

    const res = await app.inject({ method: "GET", url: "/lint" });
    expect(res.statusCode).toBe(200);
    const issues = res.json().issues as Array<{ kind: string }>;
    expect(issues.filter((i) => i.kind === "malformed-frontmatter")).toHaveLength(0);

    await app.close();
  });
});
