import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

let vaultRoot: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(path.join(tmpdir(), "tax-"));
  await mkdir(path.join(vaultRoot, "wiki", "Farm"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "wiki", "Farm", "A.md"),
    "---\ntitle: A\ntags: [farm, cowork]\n---\n"
  );
  await writeFile(
    path.join(vaultRoot, "wiki", "Farm", "B.md"),
    "---\ntitle: B\ntags: [farm]\n---\n"
  );
  vi.doMock("@/lib/config/config-io", () => ({
    readConfig: async () => ({
      vaultPath: vaultRoot,
      projectRoots: [],
      modelDefaults: { haiku: "x", sonnet: "y", opus: "z" },
      connectors: [],
    }),
  }));
  const { __resetVaultStoreForTests } = await import("@/lib/vault/store-singleton");
  __resetVaultStoreForTests();
});

afterEach(async () => {
  await rm(vaultRoot, { recursive: true, force: true });
  vi.resetModules();
});

describe("/api/taxonomy", () => {
  it("returns vault-derived tags with counts and groups", async () => {
    const { GET } = await import("@/app/api/taxonomy/route");
    const res = await GET();
    const json = await res.json();
    interface TagEntry { id: string; label: string; group: string; count: number }
    expect(json.tags.find((t: TagEntry) => t.id === "all")).toBeTruthy();
    const farm = json.tags.find((t: TagEntry) => t.id === "farm") as TagEntry;
    expect(farm.count).toBe(2);
    expect(farm.group).toBe("domain");
    const cowork = json.tags.find((t: TagEntry) => t.id === "cowork") as TagEntry;
    expect(cowork.group).toBe("lane");
  });

  it("POST returns 501", async () => {
    const { POST } = await import("@/app/api/taxonomy/route");
    const res = await POST();
    expect(res.status).toBe(501);
  });
});
