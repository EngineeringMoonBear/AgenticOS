/**
 * Integration tests for /api/vault/* route handlers.
 *
 * Strategy:
 * - Create a real tmpdir vault on disk for each test.
 * - Mock "server-only" (vi.mock at module level) so imports don't blow up in jsdom.
 * - Mock @/lib/config/config-io via vi.doMock per test to point vaultPath at the tmpdir.
 * - Call __resetVaultStoreForTests() in beforeEach/afterEach to clear the singleton.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Must be hoisted — vi.mock calls are hoisted before imports.
vi.mock("server-only", () => ({}));

// We need to mock @agenticos/vault-core/store's "server-only" import too.
// Since the vault-core package itself does `import "server-only"` we cover it above.

let tmpDir: string;

async function writeMd(
  vaultDir: string,
  relPath: string,
  content: string
): Promise<void> {
  const abs = path.join(vaultDir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}

describe("/api/vault/* integration", () => {
  beforeEach(async () => {
    // Create a fresh temp vault for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-"));
    await fs.mkdir(path.join(tmpDir, "wiki"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "inbox"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up the temp dir
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  // --- Tree ---
  it("GET /api/vault/tree returns tree built from disk", async () => {
    await writeMd(tmpDir, "wiki/Farm/Syntropic.md", "---\ntitle: Syntropic\ntags: [farm]\n---\nHello");
    await writeMd(tmpDir, "wiki/Software/Notes.md", "---\ntitle: Notes\n---\nWorld");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/tree/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tree");
    expect(body).toHaveProperty("flatPaths");
    expect(body.flatPaths).toContain("Farm/Syntropic");
    expect(body.flatPaths).toContain("Software/Notes");
  });

  // --- Page 404 ---
  it("GET /api/vault/page returns 404 for unknown paths", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/page/route");
    const url = new URL("http://localhost/api/vault/page?path=nonexistent");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(404);
  });

  // --- Page found ---
  it("GET /api/vault/page returns the page for known paths", async () => {
    await writeMd(
      tmpDir,
      "wiki/Farm/Plot.md",
      "---\ntitle: Plot A12\ntags: [farm, soil]\n---\nContent here"
    );

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/page/route");
    const url = new URL("http://localhost/api/vault/page?path=Farm/Plot");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Plot A12");
    expect(body.tags).toContain("farm");
    expect(body.tags).toContain("soil");
  });

  // --- Page missing ?path param ---
  it("GET /api/vault/page returns 400 when path param is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/page/route");
    const url = new URL("http://localhost/api/vault/page");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(400);
  });

  // --- Search ---
  it("GET /api/vault/search filters by q AND tags", async () => {
    await writeMd(tmpDir, "wiki/Farm/A.md", "---\ntitle: Nitrogen Cycle\ntags: [farm]\n---\nNitrogen fixation");
    await writeMd(tmpDir, "wiki/Software/B.md", "---\ntitle: Nitrogen in Code\ntags: [software]\n---\nNitrogen naming");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/search/route");

    // Search by q only
    const url1 = new URL("http://localhost/api/vault/search?q=nitrogen");
    const req1 = Object.assign(new Request(url1.href), { nextUrl: url1 });
    const res1 = await GET(req1 as Parameters<typeof GET>[0]);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.total).toBe(2);

    // Search by q + tags
    const url2 = new URL("http://localhost/api/vault/search?q=nitrogen&tags=farm");
    const req2 = Object.assign(new Request(url2.href), { nextUrl: url2 });
    const res2 = await GET(req2 as Parameters<typeof GET>[0]);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.total).toBe(1);
    expect(body2.results[0].title).toBe("Nitrogen Cycle");
  });

  // --- Backlinks ---
  it("GET /api/vault/backlinks returns who links to a target", async () => {
    await writeMd(tmpDir, "wiki/Target.md", "---\ntitle: Target\n---\nI am the target");
    await writeMd(tmpDir, "wiki/Source.md", "---\ntitle: Source\n---\nSee [[Target]] for details");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/backlinks/route");
    const url = new URL("http://localhost/api/vault/backlinks?path=Target");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backlinks).toContain("Source");
  });

  // --- Inbox list ---
  it("GET /api/vault/inbox lists inbox items", async () => {
    await writeMd(tmpDir, "inbox/fleeting.md", "# Quick thought\nThis is a note");
    await writeMd(tmpDir, "inbox/another.md", "# Another\nMore notes");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/inbox/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
  });

  // --- Inbox item 404 ---
  it("GET /api/vault/inbox/item returns 404 for unknown path", async () => {
    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/inbox/item/route");
    const url = new URL("http://localhost/api/vault/inbox/item?path=nonexistent.md");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(404);
  });

  // --- Inbox item found ---
  it("GET /api/vault/inbox/item returns the note for a known path", async () => {
    await writeMd(tmpDir, "inbox/idea.md", "# Big Idea\nExpand on this later");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/vault/inbox/item/route");
    const url = new URL("http://localhost/api/vault/inbox/item?path=idea.md");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Big Idea");
  });

  // --- Stats ---
  it("GET /api/vault/stats returns stats shape", async () => {
    await writeMd(tmpDir, "wiki/One.md", "# One");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    // Force a revalidation first so stats are non-zero
    const { getVaultStore } = await import("@/lib/vault/store-singleton");
    const store = await getVaultStore();
    await store.revalidate();

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    // Re-import stats route with same store state (singleton not reset)
    const { GET } = await import("@/app/api/vault/stats/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("pageCount");
    expect(body).toHaveProperty("builtAt");
    expect(body).toHaveProperty("ttlExpiresAt");
  });

  // --- Revalidate ---
  it("POST /api/vault/revalidate bumps builtAt", async () => {
    await writeMd(tmpDir, "wiki/One.md", "# One\nContent");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
    __resetVaultStoreForTests();

    const { POST } = await import("@/app/api/vault/revalidate/route");

    const before = Date.now();
    const res = await POST();
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("builtAt");
    expect(body).toHaveProperty("pageCount");
    expect(body.builtAt).toBeGreaterThanOrEqual(before);
    expect(body.builtAt).toBeLessThanOrEqual(after);
    expect(body.pageCount).toBe(1);
  });
});
