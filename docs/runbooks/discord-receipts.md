# Discord Receipts Pipeline — Setup & Operations

Spec: ~/AgenticOS-Vault/sources/2026-07-04-penny-receipt-pipeline-design.md
Plugin: packages/discord-plugin (`agenticos.discord-plugin`)

## One-time setup

1. **Discord bot**: discord.com/developers → New Application "Grove Receipts" →
   Bot tab → copy token into 1Password (`discord-bot-token` field in the
   `AgenticOS Infra` item). No privileged intents needed (REST polling only,
   MESSAGE CONTENT via bot scope on small guilds).
   OAuth2 URL generator: scope `bot`, permissions: View Channel, Send Messages,
   Read Message History, Add Reactions. Invite to the family server.
2. **Channel**: create `#receipts`; right-click → Copy Channel ID (enable
   Developer Mode in Discord settings if the option is missing). For Phase 0,
   create `#receipts-test` and use ITS id first.
3. **Spaces**: DO console → Spaces → create bucket `agenticos-receipts` (nyc3,
   private). Generate a Spaces access key pair scoped to this bucket; store as
   `spaces-receipts-key` / `spaces-receipts-secret` in the `AgenticOS Infra`
   1Password item.
4. **IDs**:
   - Company: `docker exec -it agenticos-db psql -U paperclip -c "SELECT id, name FROM companies;"`
   - Penny:   `docker exec -it agenticos-db psql -U paperclip -c "SELECT id, name FROM agents WHERE name ILIKE '%penny%';"`
   - Josh's Discord user id: right-click avatar → Copy User ID.
5. **Sync config**: on the Mac (with `op` signed in and SSH tunnel open), set
   the four non-secret env vars and run the sync script:
   ```sh
   DISCORD_RECEIPTS_CHANNEL_ID=<channel-id> \
   PAPERCLIP_COMPANY_ID=<company-id> \
   PENNY_AGENT_ID=<agent-id> \
   JOSH_DISCORD_USER_ID=<user-snowflake> \
   ./scripts/sync-paperclip-secrets.sh
   ```
   The script reads `discord-bot-token`, `spaces-receipts-key`, and
   `spaces-receipts-secret` from 1Password automatically.
6. **Deploy**: use the one-command deployer (reinstalls manifest, applies config,
   cycles the worker):
   ```sh
   scripts/deploy-plugin.sh discord-plugin
   ```
   The script handles the recreate-guard (force-recreates `paperclip-server` if
   the new bind mount isn't visible in the container yet), reinstalls the plugin,
   calls `configure_discord_plugin`, cycles disable→enable, and asserts health.
   See `docs/runbooks/deploy-plugin-manifest-change.md` for full details.

   Fallback (if you want to redeploy the whole stack manually):
   ```sh
   docker compose up -d --build paperclip-server
   ```
   Then re-run the sync script as in step 5 to push config.

   Verify plugin loaded: server logs show `discord-plugin setup` and the two jobs
   appear in the board's plugin/jobs view.

## Phase 0 smoke test (in #receipts-test)

- [ ] Post a clear receipt photo → within 10 min an issue `RCPT ...` exists, assigned to Penny.
- [ ] Spaces bucket has `receipts/YYYY/MM/...` object; presigned link in the issue description opens.
- [ ] Penny processes it: extraction comment on the issue, ✅ reply in the thread, status `in_review`, sidecar `.json` next to the image in Spaces.
- [ ] Post the SAME photo again → no duplicate issue (originId dedup).
- [ ] Post a meme → Penny dismisses: 🤷 react, issue cancelled.
- [ ] Post a deliberately blurry receipt → Penny asks for a retake, issue `blocked`.
- [ ] Trigger `weekly-digest` manually from the board (Jobs → Run) → Josh gets the DM with working image links.

## Phase 1 → 2 rollout

- Phase 1 (shadow week): repoint `receiptsChannelId` to the real `#receipts` via the
  sync script; family keeps existing habits in parallel. Success = zero dropped
  receipts, acceptable categories, one clean Sunday digest.
- Phase 2 (live): pin Penny's how-to message in `#receipts`; announce.

## Operations

- **Weekly**: Sunday digest DM → attach pass in FarmRaise → close issues in Vista
  (drag to Done). Cash receipts: create via Quick Add in FarmRaise, then close.
- **Corrections**: fix the category directly in FarmRaise; leave a one-line comment
  on the issue before closing (Penny reviews corrections weekly and viking_remembers them).
- **Cursor reset** (reprocess history): delete plugin state key `receipts-cursor`
  via the board's plugin state view, or set it to a message id to resume from.
- **Presigned links expire after 7 days**; the digest always re-signs, so use the
  newest digest's links.

## Failure modes

- Bot token revoked → ingest job logs `discord fetch failed: 401`; re-run sync script with new token.
- Spaces outage → ingest halts (cursor does not advance); recovers on next run.
- Penny miscategorizing repeatedly → tighten the category list in her duty block
  (docs/personas/penny-receipt-clerk.md) and re-apply.
