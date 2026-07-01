import { describe, it, expect } from "vitest";
import { runVaultIngest, type IngestDb, type IngestViking } from "../src/ingest/job.js";
import type { Result } from "../src/viking-client.js";
import type { VaultFile } from "../src/ingest/reconcile.js";

/** A representative host-derived namespace (= plugin_<slug>_<sha256(id)[:10]>). */
const NAMESPACE = "plugin_openviking_df76e0e812";

/**
 * In-memory fake of the path→sha state table backed by a Map. Records every raw
 * SQL string so tests can assert it is schema-qualified with the plugin namespace
 * (the Paperclip plugin-DB contract requires it).
 */
class FakeDb implements IngestDb {
  namespace = NAMESPACE;
  state = new Map<string, string>();
  sql: string[] = [];

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    this.sql.push(sql);
    if (/SELECT path, sha256/i.test(sql)) {
      return [...this.state.entries()].map(([path, sha256]) => ({ path, sha256 })) as T[];
    }
    return [];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
    this.sql.push(sql);
    if (/INSERT INTO/i.test(sql)) {
      const [path, sha256] = params as [string, string];
      this.state.set(path, sha256);
      return { rowCount: 1 };
    }
    if (/DELETE FROM/i.test(sql)) {
      const [path] = params as [string];
      this.state.delete(path);
      return { rowCount: 1 };
    }
    return { rowCount: 0 };
  }
}

/** Spy VikingClient resource API; `failContent` forces addResource failures. */
class FakeViking implements IngestViking {
  added: Array<{ content: string; filename: string; vikingUri: string }> = [];
  removed: string[] = [];
  failContent = new Set<string>();

  async addResource(content: string, filename: string, vikingUri: string): Promise<Result<void>> {
    if (this.failContent.has(content)) {
      return { ok: false, error: `forced failure for ${filename}` };
    }
    this.added.push({ content, filename, vikingUri });
    return { ok: true, data: undefined };
  }

  async rm(vikingUri: string): Promise<Result<void>> {
    this.removed.push(vikingUri);
    return { ok: true, data: undefined };
  }
}

function vf(path: string, content: string, sha256: string): VaultFile {
  return { path, content, sha256 };
}

function reader(files: VaultFile[]) {
  return async (): Promise<Result<VaultFile[]>> => ({ ok: true, data: files });
}

describe("runVaultIngest", () => {
  it("adds new files: addResource with correct viking URI + upserts state", async () => {
    const db = new FakeDb();
    const viking = new FakeViking();
    const files = [vf("HELLO.md", "# hi", "sha1"), vf("dev/notes.md", "x", "sha2")];

    const summary = await runVaultIngest({
      reader: reader(files),
      viking,
      db,
      vaultServerUrl: "http://vault",
    });

    expect(summary).toEqual({ added: 2, updated: 0, removed: 0, errors: 0 });
    expect(viking.added).toEqual([
      { content: "# hi", filename: "HELLO.md", vikingUri: "viking://resources/notes/HELLO.md" },
      { content: "x", filename: "notes.md", vikingUri: "viking://resources/dev/notes.md" },
    ]);
    expect(db.state.get("HELLO.md")).toBe("sha1");
    expect(db.state.get("dev/notes.md")).toBe("sha2");
  });

  it("updates changed files (sha differs) and skips unchanged", async () => {
    const db = new FakeDb();
    db.state.set("a.md", "old");
    db.state.set("b.md", "same");
    const viking = new FakeViking();
    const files = [vf("a.md", "new content", "new"), vf("b.md", "x", "same")];

    const summary = await runVaultIngest({
      reader: reader(files),
      viking,
      db,
      vaultServerUrl: "http://vault",
    });

    expect(summary).toEqual({ added: 0, updated: 1, removed: 0, errors: 0 });
    expect(viking.added.map((a) => a.filename)).toEqual(["a.md"]);
    expect(db.state.get("a.md")).toBe("new");
  });

  it("removes tracked-but-gone files: rm + delete state row", async () => {
    const db = new FakeDb();
    db.state.set("stale/x.md", "sha");
    db.state.set("keep.md", "k");
    const viking = new FakeViking();
    const files = [vf("keep.md", "x", "k")];

    const summary = await runVaultIngest({
      reader: reader(files),
      viking,
      db,
      vaultServerUrl: "http://vault",
    });

    expect(summary).toEqual({ added: 0, updated: 0, removed: 1, errors: 0 });
    expect(viking.removed).toEqual(["viking://resources/stale/x.md"]);
    expect(db.state.has("stale/x.md")).toBe(false);
    expect(db.state.has("keep.md")).toBe(true);
  });

  it("isolates a per-file failure: errors=1, others still processed", async () => {
    const db = new FakeDb();
    const viking = new FakeViking();
    viking.failContent.add("BOOM");
    const files = [
      vf("ok1.md", "good", "s1"),
      vf("bad.md", "BOOM", "s2"),
      vf("ok2.md", "good2", "s3"),
    ];

    const summary = await runVaultIngest({
      reader: reader(files),
      viking,
      db,
      vaultServerUrl: "http://vault",
    });

    expect(summary).toEqual({ added: 2, updated: 0, removed: 0, errors: 1 });
    expect(viking.added.map((a) => a.filename)).toEqual(["ok1.md", "ok2.md"]);
    expect(db.state.has("bad.md")).toBe(false);
    expect(db.state.get("ok1.md")).toBe("s1");
    expect(db.state.get("ok2.md")).toBe("s3");
  });

  it("qualifies every statement with the plugin namespace and never emits DDL", async () => {
    const db = new FakeDb();
    db.state.set("gone.md", "g");
    const viking = new FakeViking();
    const files = [vf("new.md", "x", "s1")];

    await runVaultIngest({ reader: reader(files), viking, db, vaultServerUrl: "http://vault" });

    // Exercised SELECT (read state) + INSERT (add) + DELETE (remove) paths.
    expect(db.sql.length).toBeGreaterThanOrEqual(3);
    for (const q of db.sql) {
      // Schema-qualified — never the bare table — and no runtime DDL.
      expect(q).toContain(`${NAMESPACE}.vault_ingest_state`);
      expect(q).not.toMatch(/CREATE TABLE/i);
    }
  });

  it("upsert never references the `excluded` pseudo-table (validator-safe)", async () => {
    const db = new FakeDb();
    const viking = new FakeViking();
    const files = [vf("a.md", "x", "s1")];

    await runVaultIngest({ reader: reader(files), viking, db, vaultServerUrl: "http://vault" });

    const insert = db.sql.find((q) => /INSERT INTO/i.test(q));
    expect(insert).toBeDefined();
    expect(insert).not.toMatch(/excluded\./i);
    expect(insert).toContain("DO UPDATE SET sha256 = $2");
  });

  it("throws when the reader fails (whole run aborts)", async () => {
    const db = new FakeDb();
    const viking = new FakeViking();

    await expect(
      runVaultIngest({
        reader: async () => ({ ok: false, error: "vault unreachable" }),
        viking,
        db,
        vaultServerUrl: "http://vault",
      }),
    ).rejects.toThrow(/vault unreachable/);
  });
});
