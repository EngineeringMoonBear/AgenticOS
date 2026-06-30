-- vault_ingest_state — path→sha256 reconciliation state for the vault-ingest job,
-- so unchanged vault files are not re-ingested into OpenViking on every run.
--
-- Fully schema-qualified with this plugin's host-derived namespace
-- (plugin_openviking_<sha256(pluginKey)[:10]>), because the Paperclip plugin-DB
-- contract forbids runtime DDL (ctx.db.execute rejects CREATE/ALTER/DROP) and
-- requires migration statements to use fully-qualified namespace names
-- (validatePluginMigrationStatement). The namespace is deterministic from the
-- plugin id "agenticos.openviking-plugin" + slug "openviking"; if either
-- changes, regenerate this name.
CREATE TABLE plugin_openviking_df76e0e812.vault_ingest_state (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL
);
