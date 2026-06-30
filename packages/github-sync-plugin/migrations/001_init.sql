-- github_sync_mapping — links a Paperclip issue to its mirrored GitHub issue,
-- plus the sync origin used for loop prevention.
--
-- Fully schema-qualified with this plugin's host-derived namespace
-- (plugin_github_sync_<sha256(pluginKey)[:10]>), because the Paperclip plugin-DB
-- contract forbids runtime DDL (ctx.db.execute rejects CREATE) and requires
-- migration statements to use fully-qualified namespace names. The namespace is
-- deterministic from the plugin id "agenticos.github-sync-plugin" + slug
-- "github_sync"; if either changes, regenerate this name.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_sync_mapping (
  paperclip_issue_id TEXT PRIMARY KEY,
  github_repo TEXT NOT NULL,
  github_issue_number INTEGER NOT NULL,
  last_synced_at TEXT NOT NULL,
  origin TEXT NOT NULL
);
