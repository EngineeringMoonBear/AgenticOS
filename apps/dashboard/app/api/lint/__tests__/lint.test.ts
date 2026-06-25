/**
 * Integration tests for GET /api/lint.
 *
 * Strategy mirrors the vault integration tests:
 * - Create a real tmpdir vault per test.
 * - Mock "server-only" so server imports don't blow up in jsdom.
 * - Mock @/lib/config/config-io via vi.doMock per test.
 * - Reset the store singleton in beforeEach/afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

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

describe("GET /api/lint", () => {
  beforeEach(async () => {
    // Local-store path: ensure remote mode is off so getVaultStore() picks the
    // InMemoryVaultStore that reads tmpDir.
    delete process.env.VAULT_SERVER_URL;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lint-test-"));
    await fs.mkdir(path.join(tmpDir, "wiki"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "inbox"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns all issues when no kind param is given", async () => {
    // broken link: A.md links to [[Missing]]
    await writeMd(
      tmpDir,
      "wiki/A.md",
      "---\ntitle: A\n---\nSee [[Missing]] for details"
    );
    // orphan: B.md has no incoming/outgoing links
    await writeMd(tmpDir, "wiki/B.md", "---\ntitle: B\n---\nStandalone page");
    // todo: C.md has a TODO comment
    await writeMd(tmpDir, "wiki/C.md", "---\ntitle: C\n---\nTODO fix this");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import(
      "@/lib/vault/store-singleton"
    );
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/lint/route");
    const url = new URL("http://localhost/api/lint");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("issues");
    const kinds = (body.issues as { kind: string }[]).map((i) => i.kind);
    expect(kinds).toContain("broken-link");
    expect(kinds).toContain("orphan");
    expect(kinds).toContain("todo");
  });

  it("filters to broken-link issues when kind=broken-link", async () => {
    await writeMd(
      tmpDir,
      "wiki/A.md",
      "---\ntitle: A\n---\nSee [[Missing]] for details"
    );
    await writeMd(tmpDir, "wiki/B.md", "---\ntitle: B\n---\nTODO something");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import(
      "@/lib/vault/store-singleton"
    );
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/lint/route");
    const url = new URL("http://localhost/api/lint?kind=broken-link");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    const kinds = (body.issues as { kind: string }[]).map((i) => i.kind);
    expect(kinds.every((k) => k === "broken-link")).toBe(true);
    expect(kinds.length).toBeGreaterThan(0);
  });

  it("falls back to all issues when kind param is invalid", async () => {
    await writeMd(
      tmpDir,
      "wiki/A.md",
      "---\ntitle: A\n---\nSee [[NoExist]] here\nTODO something"
    );
    // orphan: B.md has no links
    await writeMd(tmpDir, "wiki/B.md", "---\ntitle: B\n---\nIsolated");

    vi.resetModules();
    vi.doMock("@/lib/config/config-io", () => ({
      readConfig: async () => ({ vaultPath: tmpDir }),
    }));
    const { __resetVaultStoreForTests } = await import(
      "@/lib/vault/store-singleton"
    );
    __resetVaultStoreForTests();

    const { GET } = await import("@/app/api/lint/route");
    const url = new URL("http://localhost/api/lint?kind=invalid");
    const req = Object.assign(new Request(url.href), { nextUrl: url });
    const res = await GET(req as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return all kinds, not just "invalid"
    const kinds = new Set(
      (body.issues as { kind: string }[]).map((i) => i.kind)
    );
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("degrades to empty issues in remote mode (VAULT_SERVER_URL set)", async () => {
    // In remote mode the vault store is RemoteVaultClient, whose lint() is a
    // notSupported() stub. The route must short-circuit to an empty result
    // instead of throwing a 500 on every poll.
    process.env.VAULT_SERVER_URL = "http://vault-server:7777";
    try {
      const { GET } = await import("@/app/api/lint/route");
      const url = new URL("http://localhost/api/lint");
      const req = Object.assign(new Request(url.href), { nextUrl: url });
      const res = await GET(req as Parameters<typeof GET>[0]);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.issues).toEqual([]);
      expect(body.unavailable).toBe(true);
    } finally {
      delete process.env.VAULT_SERVER_URL;
    }
  });
});
