import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTreeRoute } from "./tree.js";
import { resetStoreForTests } from "../lib/vault-store.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

describe("GET /tree", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("returns the tree of the fixture vault", async () => {
    const app = Fastify();
    registerTreeRoute(app, {
      port: 7777,
      vaultRoot: fixtureRoot,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/tree" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tree).toBeDefined();
    expect(Array.isArray(body.flatPaths)).toBe(true);
    // The store reads vaultRoot/wiki/ and returns extension-less WikiPaths.
    // Fixture: wiki/HELLO.md -> "HELLO", wiki/farming/notes.md -> "farming/notes".
    expect(body.flatPaths).toContain("HELLO");
    expect(body.flatPaths).toContain("farming/notes");

    await app.close();
  });
});
