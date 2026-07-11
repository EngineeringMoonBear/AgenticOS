import { describe, it, expect } from "vitest";
import { recordError, recentErrors, buildSwallowedFailurePing, type ErrorRow } from "../src/error-log.js";
import type { MappingDb } from "../src/mapping.js";

/**
 * In-memory fake of the `github_sync_error` table. Backs the two statements the
 * store issues: the INSERT (recordError) and the `ORDER BY occurred_at DESC LIMIT`
 * SELECT (recentErrors). Column shape mirrors migrations/003_error_log.sql — note
 * `context` is stored as a JSON TEXT string, exactly as the store serializes it.
 */
function makeErrorDb(): MappingDb & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    namespace: "plugin_github_sync_test",
    rows,
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (/ORDER BY occurred_at DESC/i.test(sql)) {
        const limit = Number(params?.[0] ?? 50);
        return [...rows]
          .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))
          .slice(0, limit) as T[];
      }
      return [];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (/INSERT INTO/i.test(sql)) {
        const [occurredAt, scope, detail, context] = params ?? [];
        rows.push({ occurred_at: occurredAt, scope, detail, context });
      }
      return { rowCount: 1 };
    },
  };
}

describe("recordError / recentErrors", () => {
  it("persists a swallowed failure and reads it back, newest first", async () => {
    const db = makeErrorDb();
    await recordError(db, {
      occurredAt: "2026-07-11T00:00:00.000Z",
      scope: "issue.created handler failed",
      detail: "boom",
      context: { issueId: "abc" },
    });
    await recordError(db, {
      occurredAt: "2026-07-11T00:01:00.000Z",
      scope: "inbound webhook: handler failed (github-app)",
      detail: "kapow",
      context: { endpointKey: "github-app" },
    });

    const recent = await recentErrors(db);
    expect(recent).toHaveLength(2);
    // Newest first.
    expect(recent[0].scope).toBe("inbound webhook: handler failed (github-app)");
    expect(recent[0].detail).toBe("kapow");
    expect(recent[0].context).toEqual({ endpointKey: "github-app" });
    expect(recent[1].detail).toBe("boom");
  });

  it("serializes context to JSON TEXT and stores NULL for empty context", async () => {
    const db = makeErrorDb();
    await recordError(db, { occurredAt: "2026-07-11T00:00:00.000Z", scope: "s", detail: "d" });
    expect(db.rows[0].context).toBeNull();

    await recordError(db, {
      occurredAt: "2026-07-11T00:00:01.000Z",
      scope: "s",
      detail: "d",
      context: {},
    });
    // An empty context object is treated as no context (NULL), not "{}".
    expect(db.rows[1].context).toBeNull();

    await recordError(db, {
      occurredAt: "2026-07-11T00:00:02.000Z",
      scope: "s",
      detail: "d",
      context: { k: "v" },
    });
    expect(db.rows[2].context).toBe(JSON.stringify({ k: "v" }));
  });

  it("respects the limit argument", async () => {
    const db = makeErrorDb();
    for (let i = 0; i < 5; i++) {
      await recordError(db, {
        occurredAt: `2026-07-11T00:00:0${i}.000Z`,
        scope: "s",
        detail: `d${i}`,
      });
    }
    const recent = await recentErrors(db, 2);
    expect(recent.map((r: ErrorRow) => r.detail)).toEqual(["d4", "d3"]);
  });

  it("tolerates a corrupt (non-JSON) context on read", async () => {
    const db = makeErrorDb();
    db.rows.push({ occurred_at: "2026-07-11T00:00:00.000Z", scope: "s", detail: "d", context: "not json" });
    const recent = await recentErrors(db);
    expect(recent[0].context).toBeUndefined();
  });
});

describe("buildSwallowedFailurePing", () => {
  it("prefixes with the 🚨 alert marker and includes scope + detail", () => {
    const msg = buildSwallowedFailurePing("inbound webhook: handler failed (github-app)", "boom");
    expect(msg).toBe("🚨 github-sync failure — inbound webhook: handler failed (github-app): boom");
  });

  it("truncates a very long detail so it can't blow Discord's content limit", () => {
    const long = "x".repeat(1000);
    const msg = buildSwallowedFailurePing("scope", long);
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(600);
  });
});
