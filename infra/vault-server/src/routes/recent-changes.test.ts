import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerRecentChangesRoute } from "./recent-changes.js";

const configWithSyncthing = {
  port: 7777,
  vaultRoot: "/tmp",
  syncthingUrl: "http://st:8384",
  syncthingApiKey: "key",
  syncthingFolderId: "agenticos-vault",
};

describe("GET /recent-changes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns Syncthing events filtered to vault folder activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 1, type: "ItemFinished", time: "2026-05-30T01:00:00Z", data: { folder: "agenticos-vault", item: "a.md", action: "update" } },
            { id: 2, type: "FolderSummary", time: "2026-05-30T01:00:01Z", data: {} }, // filtered out (wrong type)
            { id: 3, type: "ItemFinished", time: "2026-05-30T01:00:02Z", data: { folder: "other-folder", item: "z.md", action: "update" } }, // filtered out (wrong folder)
          ]),
          { status: 200 },
        ),
      ),
    );

    const app = Fastify();
    registerRecentChangesRoute(app, configWithSyncthing);

    const res = await app.inject({ method: "GET", url: "/recent-changes" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].path).toBe("a.md");
    expect(body.changes[0].kind).toBe("updated");

    await app.close();
  });

  it("returns {available: false} when Syncthing is unconfigured", async () => {
    const app = Fastify();
    registerRecentChangesRoute(app, {
      ...configWithSyncthing,
      syncthingUrl: undefined,
      syncthingApiKey: undefined,
    });

    const res = await app.inject({ method: "GET", url: "/recent-changes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);

    await app.close();
  });
});
