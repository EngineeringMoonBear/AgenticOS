-- Rename the agent PR-review reviewer slug `alice` -> `ada` (GOL-713). The board
-- retired the "alice" reviewer identity; the plugin now emits `agent-review/ada`
-- and keys review records by "ada" (pr-review.ts CHECK_CONTEXT / pr-signoff.ts).
--
-- Migrate any in-flight review rows so a later sign-off completes their pending
-- check as `agent-review/ada` on the current head SHA instead of orphaning as a
-- stuck-pending `agent-review/alice` check that pr-signoff.ts would no longer
-- reconcile (it now looks up the row by reviewer = 'ada').
--
-- Safe / idempotent: the PK is (github_repo, pr_number, reviewer). No 'ada' row can
-- pre-exist this migration (the code only began emitting 'ada' in the same release),
-- so the UPDATE cannot collide with an existing 'ada' row; a re-run matches zero
-- rows. Same host-derived namespace as 001/002 (plugin id "agenticos.github-sync-plugin"
-- + slug "github_sync"); regenerate if either changes.
UPDATE plugin_github_sync_40eceaaa3a.github_pr_review
   SET reviewer = 'ada'
 WHERE reviewer = 'alice';
