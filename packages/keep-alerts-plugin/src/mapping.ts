/**
 * `keep_alert_mapping` — the plugin-DB-namespace link between a Keep alert
 * **fingerprint** and the Paperclip issue minted for it, plus the open/resolved
 * lifecycle state and occurrence count used to dedupe re-fires and to detect a
 * post-resolution recurrence (flap).
 *
 * The table is created by `migrations/001_init.sql` (the Paperclip plugin-DB
 * contract forbids runtime DDL — `ctx.db.execute` rejects CREATE/ALTER/DROP).
 * Every runtime statement must be SCHEMA-QUALIFIED with the host-derived
 * namespace, which the SDK exposes as `ctx.db.namespace`.
 */
export interface MappingDb {
  /** Host-derived Postgres schema for this plugin (ctx.db.namespace). */
  namespace: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }>;
}

/** Lifecycle state of the alert's Paperclip issue. */
export type AlertState = "open" | "resolved";

export interface AlertMappingRow {
  fingerprint: string;
  paperclipIssueId: string;
  alertName: string;
  severity: string;
  state: AlertState;
  /** How many times the alert has fired (create + every re-fire/recurrence). */
  fireCount: number;
  firstSeenAt: string;
  lastFiredAt: string;
}

export const MAPPING_TABLE = "keep_alert_mapping";

/** Fully-qualified `<namespace>.keep_alert_mapping` for runtime SQL. */
function qualifiedTable(db: MappingDb): string {
  return `${db.namespace}.${MAPPING_TABLE}`;
}

function toRow(raw: Record<string, unknown>): AlertMappingRow {
  return {
    fingerprint: String(raw.fingerprint),
    paperclipIssueId: String(raw.paperclip_issue_id),
    alertName: String(raw.alert_name ?? ""),
    severity: String(raw.severity ?? ""),
    state: raw.state === "resolved" ? "resolved" : "open",
    fireCount: Number(raw.fire_count ?? 0),
    firstSeenAt: String(raw.first_seen_at),
    lastFiredAt: String(raw.last_fired_at),
  };
}

/** Look up the mapping for an alert fingerprint, or null if none exists. */
export async function getByFingerprint(
  db: MappingDb,
  fingerprint: string,
): Promise<AlertMappingRow | null> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT fingerprint, paperclip_issue_id, alert_name, severity, state, fire_count, first_seen_at, last_fired_at
       FROM ${qualifiedTable(db)} WHERE fingerprint = $1`,
    [fingerprint],
  );
  const first = rows[0];
  return first ? toRow(first) : null;
}

/**
 * Insert the mapping row for a first-firing alert. Fingerprint is the PK, so a
 * concurrent duplicate delivery raises a conflict rather than a second issue —
 * we upsert-on-conflict as a no-op guard (the racing caller already created it).
 */
export async function insertNew(db: MappingDb, row: AlertMappingRow): Promise<void> {
  await db.execute(
    `INSERT INTO ${qualifiedTable(db)}
       (fingerprint, paperclip_issue_id, alert_name, severity, state, fire_count, first_seen_at, last_fired_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (fingerprint) DO NOTHING`,
    [
      row.fingerprint,
      row.paperclipIssueId,
      row.alertName,
      row.severity,
      row.state,
      row.fireCount,
      row.firstSeenAt,
      row.lastFiredAt,
    ],
  );
}

/**
 * Update the lifecycle state, fire count, severity and last-fired timestamp for
 * an existing alert (re-fire, post-resolution recurrence, or resolution). Keyed
 * by fingerprint; the Paperclip issue id never changes for a fingerprint.
 */
export async function updateState(
  db: MappingDb,
  fingerprint: string,
  patch: { state: AlertState; fireCount: number; severity: string; lastFiredAt: string },
): Promise<void> {
  await db.execute(
    `UPDATE ${qualifiedTable(db)}
        SET state = $2, fire_count = $3, severity = $4, last_fired_at = $5
      WHERE fingerprint = $1`,
    [fingerprint, patch.state, patch.fireCount, patch.severity, patch.lastFiredAt],
  );
}
