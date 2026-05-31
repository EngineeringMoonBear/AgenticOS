import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerSearchRoute } from "./search.js";
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
  syncthingApiKey: undefined,
};

describe("GET /search", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("returns matching pages with a total", async () => {
    const app = Fastify();
    registerSearchRoute(app, config);

    const res = await app.inject({ method: "GET", url: "/search?q=farming" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.total).toBe(body.results.length);
    expect(body.total).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it("filters by tag", async () => {
    const app = Fastify();
    registerSearchRoute(app, config);

    const res = await app.inject({
      method: "GET",
      url: "/search?q=&tags=farming",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const paths = body.results.map((p: { path: string }) => p.path);
    expect(paths).toContain("farming/notes");
    expect(paths).not.toContain("HELLO");

    await app.close();
  });

  it("returns 400 when q is missing", async () => {
    const app = Fastify();
    registerSearchRoute(app, config);
    const res = await app.inject({ method: "GET", url: "/search" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
