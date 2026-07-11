-- github_sync_error — a queryable, per-plugin sink for SWALLOWED worker failures
-- (GOL-296). Before this, a caught exception in onWebhook or an event dispatch only
-- reached host stderr (the ~290MB server.log); `plugin_logs` stays empty because the
-- host's plugin-log notification isn't wired to a queryable sink, and that wiring is
-- upstream @paperclipai host code we don't own. This table is the piece we DO own: a
-- durable `SELECT … ORDER BY occurred_at DESC` view of recent swallowed failures,
-- reachable over DATABASE_URL with NO server.log access — the exact gap that made
-- GOL-295's one-line throw need a runtime dig.
--
-- Same host-derived namespace as 001/002 (plugin id "agenticos.github-sync-plugin" +
-- slug "github_sync"); regenerate if either changes. Runtime DDL is forbidden by the
-- plugin-DB contract, so this table MUST come from a migration.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_sync_error (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  detail TEXT NOT NULL,
  -- JSON-serialized side context (endpointKey, issueId, …). Stored as TEXT to avoid
  -- any host JSONB param-binding quirk; parsed back best-effort on read.
  context TEXT
);
CREATE INDEX github_sync_error_occurred_at_idx
  ON plugin_github_sync_40eceaaa3a.github_sync_error (occurred_at DESC);
