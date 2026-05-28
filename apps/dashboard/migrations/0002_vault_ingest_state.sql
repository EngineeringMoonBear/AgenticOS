-- Vault ingest state — Phase 1A of v2-unified-dashboard.
-- Tracks what the hourly vault→OpenViking ingester has pushed, so we
-- can sha-skip unchanged files and detect deletions.
-- See: docs/plans/v2-unified-dashboard.md Task 1.1

CREATE TABLE IF NOT EXISTS vault_ingest_state (
  path           TEXT PRIMARY KEY,
  sha256         CHAR(64) NOT NULL,
  scope          TEXT NOT NULL,
  viking_uri     TEXT NOT NULL,
  last_ingested  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL CHECK (status IN ('ok','errored')),
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_ingest_state_scope ON vault_ingest_state (scope);
