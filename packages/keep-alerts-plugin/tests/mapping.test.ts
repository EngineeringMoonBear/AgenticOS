import { describe, it, expect } from "vitest";
import { getByFingerprint, insertNew, updateState, type MappingDb, type AlertMappingRow } from "../src/mapping.js";

/**
 * A tiny in-memory stand-in for the plugin DB. It records the SQL + params so we
 * can assert the statements are namespace-qualified and shaped correctly without
 * a live Postgres. Reads are served from a fingerprint-keyed map.
 */
function fakeDb(seed: AlertMappingRow[] = []): MappingDb & { calls: { sql: string; params: unknown[] }[] } {
  const store = new Map<string, AlertMappingRow>();
  for (const r of seed) store.set(r.fingerprint, r);
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    namespace: "plugin_keep_alerts_ca083f9ab4",
    calls,
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const fp = String(params[0]);
      const row = store.get(fp);
      if (!row) return [] as never[];
      return [
        {
          fingerprint: row.fingerprint,
          paperclip_issue_id: row.paperclipIssueId,
          alert_name: row.alertName,
          severity: row.severity,
          state: row.state,
          fire_count: row.fireCount,
          first_seen_at: row.firstSeenAt,
          last_fired_at: row.lastFiredAt,
        },
      ] as never[];
    },
    async execute(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
}

const ROW: AlertMappingRow = {
  fingerprint: "fp-1",
  paperclipIssueId: "issue-1",
  alertName: "Disk full",
  severity: "critical",
  state: "open",
  fireCount: 1,
  firstSeenAt: "2026-07-08T00:00:00.000Z",
  lastFiredAt: "2026-07-08T00:00:00.000Z",
};

describe("mapping SQL", () => {
  it("qualifies every statement with the plugin namespace", async () => {
    const db = fakeDb();
    await insertNew(db, ROW);
    await updateState(db, "fp-1", { state: "resolved", fireCount: 2, severity: "critical", lastFiredAt: "t" });
    await getByFingerprint(db, "fp-1");
    for (const c of db.calls) {
      expect(c.sql).toContain("plugin_keep_alerts_ca083f9ab4.keep_alert_mapping");
    }
  });

  it("insertNew uses ON CONFLICT DO NOTHING (idempotent on duplicate delivery)", async () => {
    const db = fakeDb();
    await insertNew(db, ROW);
    expect(db.calls[0]?.sql).toContain("ON CONFLICT (fingerprint) DO NOTHING");
    expect(db.calls[0]?.params[0]).toBe("fp-1");
  });

  it("getByFingerprint round-trips a seeded row and returns null when absent", async () => {
    const db = fakeDb([ROW]);
    const got = await getByFingerprint(db, "fp-1");
    expect(got).toMatchObject({ paperclipIssueId: "issue-1", state: "open", fireCount: 1 });
    expect(await getByFingerprint(db, "missing")).toBeNull();
  });
});
