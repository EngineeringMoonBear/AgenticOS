import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerDiscardRoute } from "./discard.js";
import { resetStoreForTests } from "../lib/vault-store.js";

let tmp: string;
function cfg() {
  return { port: 7777, vaultRoot: tmp, wikiSubdir: "wiki", syncthingUrl: undefined, syncthingApiKey: undefined };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-discard-"));
  await fs.mkdir(path.join(tmp, "inbox"), { recursive: true });
  resetStoreForTests();
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("POST /discard", () => {
  it("archives the inbox note and returns 200", async () => {
    await fs.writeFile(path.join(tmp, "inbox", "x.md"), "# X\n\nbody", "utf8");
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: { inboxPath: "x.md" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().archivedPath).toContain("archived");
    await expect(fs.access(path.join(tmp, "inbox", "x.md"))).rejects.toThrow();
    await app.close();
  });

  it("400s on a path traversal attempt", async () => {
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: { inboxPath: "../escape.md" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400s when inboxPath is missing", async () => {
    const app = Fastify();
    registerDiscardRoute(app, cfg());
    const res = await app.inject({ method: "POST", url: "/discard", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
