-- github_ci_failure — one row per (repo, PR#). Backs the CI→Paperclip fix-issue
-- loop (GOL-305, plugin v0.9.0). A failing CI check on an agent-authored PR opens
-- (or updates in place) a Paperclip fix issue assigned to the authoring agent; a
-- green check-suite auto-closes it. This row is the loop-guard: one fix issue per
-- (repo, PR#), so a re-fail updates the SAME issue instead of spawning duplicates,
-- and `status` records whether that issue is currently open ('open') or already
-- auto-closed/resolved ('closed') so a redelivery is a no-op.
--
-- Same host-derived namespace as 001/002/003 (plugin id "agenticos.github-sync-plugin"
-- + slug "github_sync"); regenerate if either changes. Runtime DDL is forbidden by
-- the plugin-DB contract, so this table MUST come from a migration.
CREATE TABLE plugin_github_sync_40eceaaa3a.github_ci_failure (
  github_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  paperclip_issue_id TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (github_repo, pr_number)
);
