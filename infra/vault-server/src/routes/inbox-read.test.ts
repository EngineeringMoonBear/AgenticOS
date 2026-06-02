import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerInboxReadRoute } from "./inbox-read.js";
import { resetStoreForTests } from "../lib/vault-store.js";

let tmp: string;
const cfg = () => ({ port: 7777, vaultRoot: tmp, wikiSubdir: "wiki", syncthingUrl: undefined, syncthingApiKey: undefined });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vs-inboxread-"));
  await fs.mkdir(path.join(tmp, "inbox"), { recursive: true });
  resetStoreForTests();
});
afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

describe("GET /inbox/:path", () => {
  it("returns the note body + title", async () => {
    await fs.writeFile(path.join(tmp, "inbox", "note.md"), "# Title\n\nhello body", "utf8");
    const app = Fastify();
    registerInboxReadRoute(app, cfg());
    const res = await app.inject({ method: "GET", url: "/inbox/note.md" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.title).toBe("Title");
    expect(b.body).toContain("hello body");
    await app.close();
  });

  it("404s for an unknown note", async () => {
    const app = Fastify();
    registerInboxReadRoute(app, cfg());
    const res = await app.inject({ method: "GET", url: "/inbox/missing.md" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
