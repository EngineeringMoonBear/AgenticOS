import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerPageRoute } from "./page.js";
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

describe("GET /page", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("returns a page by WikiPath", async () => {
    const app = Fastify();
    registerPageRoute(app, config);

    const res = await app.inject({ method: "GET", url: "/page?path=HELLO" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Hello");
    expect(body.path).toBe("HELLO");
    expect(body.tags).toContain("test");

    await app.close();
  });

  it("returns 400 when path is missing", async () => {
    const app = Fastify();
    registerPageRoute(app, config);
    const res = await app.inject({ method: "GET", url: "/page" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when the page is not found", async () => {
    const app = Fastify();
    registerPageRoute(app, config);
    const res = await app.inject({ method: "GET", url: "/page?path=nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
