import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerBacklinksRoute } from "./backlinks.js";
import { resetStoreForTests } from "../lib/vault-store.js";
import type { Config } from "../config.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

const config: Config = {
  port: 7777,
  vaultRoot: fixtureRoot,
  syncthingUrl: undefined,
  syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault",
};

describe("GET /backlinks", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("returns the pages linking to the target", async () => {
    const app = Fastify();
    registerBacklinksRoute(app, config);

    // wiki/HELLO.md contains [[farming/notes]], so farming/notes is linked by HELLO.
    const res = await app.inject({
      method: "GET",
      url: "/backlinks?path=farming/notes",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.backlinks)).toBe(true);
    expect(body.backlinks).toContain("HELLO");

    await app.close();
  });

  it("returns 400 when path is missing", async () => {
    const app = Fastify();
    registerBacklinksRoute(app, config);
    const res = await app.inject({ method: "GET", url: "/backlinks" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
