-- keep_alert_mapping — links a Keep alert fingerprint to the Paperclip issue
-- minted for it, plus the open/resolved lifecycle state and occurrence count
-- used to dedupe re-fires (comment, never duplicate) and to detect a
-- post-resolution recurrence (reopen).
--
-- Fully schema-qualified with this plugin's host-derived namespace
-- (plugin_<namespaceSlug>_<sha256(pluginId)[:10]>), because the Paperclip
-- plugin-DB contract forbids runtime DDL (ctx.db.execute rejects CREATE) and
-- requires migration statements to use fully-qualified namespace names. The
-- namespace is deterministic from the plugin id "agenticos.keep-alerts-plugin"
-- (sha256[:10] = ca083f9ab4) + slug "keep_alerts"; if either changes,
-- regenerate this name.
CREATE TABLE plugin_keep_alerts_ca083f9ab4.keep_alert_mapping (
  fingerprint TEXT PRIMARY KEY,
  paperclip_issue_id TEXT NOT NULL,
  alert_name TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL,
  fire_count INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_fired_at TEXT NOT NULL
);
