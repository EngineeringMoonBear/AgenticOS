import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerInboxRoute } from "./inbox.js";
import { resetStoreForTests } from "../lib/vault-store.js";
import type { Config } from "../config.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test",
  "fixtures",
  "sample-vault",
);

function makeConfig(vaultRoot: string): Config {
  return { port: 7777, vaultRoot, syncthingUrl: undefined, syncthingApiKey: undefined, syncthingFolderId: "agenticos-vault" };
}

describe("GET /inbox", () => {
  beforeEach(() => {
    resetStoreForTests();
  });

  it("lists inbox notes from vaultRoot/inbox/", async () => {
    const app = Fastify();
    registerInboxRoute(app, makeConfig(fixtureRoot));

    const res = await app.inject({ method: "GET", url: "/inbox" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const paths = body.items.map((i: { path: string }) => i.path);
    expect(paths).toContain("quick-capture.md");

    await app.close();
  });

  it("returns an empty list when there is no inbox dir", async () => {
    const app = Fastify();
    // Point at the wiki/ subdir, which has no nested inbox/ — listInbox -> [].
    registerInboxRoute(app, makeConfig(path.join(fixtureRoot, "wiki")));

    const res = await app.inject({ method: "GET", url: "/inbox" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);

    await app.close();
  });
});
