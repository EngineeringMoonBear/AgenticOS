-- AgenticOS Spec 1 — telemetry schema.
-- See: docs/superpowers/specs/2026-05-22-spec1-orchestrator-cost-observability-design.md §3.6
-- And: docs/superpowers/specs/spec1-verified-api-shapes.md §2 (cached_input_tokens addition)

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','budget-blocked')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  hermes_skill  TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  cost_cents    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calls (
  id                    BIGSERIAL PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id               TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL,
  model                 TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL,
  cached_input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents            INTEGER NOT NULL DEFAULT 0,
  latency_ms            INTEGER NOT NULL,
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_started_at  ON tasks (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_task_id_occurred   ON calls (task_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_openai_occurred    ON calls (occurred_at DESC) WHERE provider = 'openai';

CREATE TABLE IF NOT EXISTS budget (
  id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_cap_cents    INTEGER NOT NULL DEFAULT 3000,
  soft_alert_pct       SMALLINT NOT NULL DEFAULT 80,
  reset_day_of_month   SMALLINT NOT NULL DEFAULT 1
);
INSERT INTO budget (id) VALUES (1) ON CONFLICT DO NOTHING;
