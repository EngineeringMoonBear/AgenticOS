-- github_pr_review — one row per (repo, PR, reviewer). Backs the agent PR review
-- pipeline (GOL-158, plugin v0.7.0). Idempotency is keyed on head_sha: a webhook
-- redelivery for the same head SHA is a no-op; a new head SHA (synchronize / new
-- commits) reopens the existing review issue rather than creating a duplicate.
--
-- Same host-derived namespace as 001 (plugin id "agenticos.github-sync-plugin" +
-- slug "github_sync"); regenerate if either changes. Runtime DDL is forbidden by
-- the plugin-DB contract, so this table MUST come from a migration.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_pr_review (
  github_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  paperclip_issue_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (github_repo, pr_number, reviewer)
);
