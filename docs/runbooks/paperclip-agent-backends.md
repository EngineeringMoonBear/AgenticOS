# Runbook — Paperclip agent backends (adapters & auth)

Paperclip is the orchestrator ("mainframe"); each agent runs on a pluggable
**adapter** that shells out to a local CLI in the `paperclip-server` container.
The container ships four CLIs (`vendor/paperclip/Dockerfile`): `claude`,
`codex`, `opencode`, `gemini`.

| Adapter | Runtime CLI | Auth / cost | Notes |
| --- | --- | --- | --- |
| `claude_local` | `claude` | **Claude Max subscription (OAuth)** | Primary driver. Strong reasoning — best for technical *and* executive (CEO/CFO) personas. Memory is via plugins, not the adapter. |
| `codex_local` | `codex` | OpenAI **API key** | `OPENAI_API_KEY` in env. |
| `opencode_local` | `opencode` | depends on `model` | Route to **Ollama** for free local inference (see below). |
| `gemini_local` | `gemini` | Google API | Available; not in the primary plan. |
| `hermes_local` | `hermes` (Python) | — | **Vestigial.** Registered in the fork but the `hermes` CLI is NOT installed (Hermes retired, ADR 0006). Selectable in the UI but fails at runtime: `Hermes CLI "hermes" not found`. Don't use it. |

**Memory is not adapter-specific.** Long-term memory is OpenViking + the vault,
exposed as Paperclip *plugins* (`openviking-plugin`, `vault-plugin`) available to
every adapter equally. Any persona on any backend gets the same memory.

---

## Claude on the Max subscription (not API billing)

By default `claude` uses `ANTHROPIC_API_KEY` if present (pay-per-token), which
overrides subscription OAuth. To run Claude agents on your Max plan:

`HOME=/paperclip` in the container, and `/paperclip` is the persistent
`paperclip-data` volume — so a one-time login survives restarts. No volume work.

1. **Log in inside the container** (interactive; do this while the key is still
   present — login writes OAuth creds regardless):
   ```bash
   ssh deploy@<droplet>
   cd /opt/agenticos
   docker compose exec -it paperclip-server claude /login
   # follow the device-code URL, sign in with the Max account
   # creds land in /paperclip/.claude/.credentials.json (persisted)
   ```
2. **Remove `ANTHROPIC_API_KEY` from `/opt/agenticos/.env`** (env_file injects it
   directly, bypassing docker-compose.yml). Idempotent, preserves perms:
   ```bash
   cd /opt/agenticos
   umask 077
   grep -v '^ANTHROPIC_API_KEY=' .env > .env.tmp 2>/dev/null || true
   chmod 600 .env.tmp && mv .env.tmp .env
   grep -c '^ANTHROPIC_API_KEY=' .env   # expect 0
   ```
   (`docker-compose.yml` no longer passes it in `environment:` either — both
   paths must be clear.)
3. **Recreate paperclip-server** so it starts without the key (`up -d`, NOT
   `docker restart` — restart won't re-read env_file):
   ```bash
   docker compose up -d paperclip-server
   ```
4. **Verify:** create/run a `claude_local` agent — the probe warning
   ("ANTHROPIC_API_KEY is set … API-key auth") should be gone, and
   `docker compose exec paperclip-server claude` reports login via claude.ai.

**Rollback / opt-in API billing:** don't put the key back in `.env`. Instead set
`ANTHROPIC_API_KEY` in **Paperclip Secrets** for the specific agent that should
bill per-token. Keeps subscription the default; API billing becomes explicit.

---

## Ollama-backed agents (free local inference)

There is **no Ollama adapter.** Ollama runs as its own service (`ollama:11434`
on the compose network) and is reached through `opencode_local`:

1. **Pull a model** into Ollama (Droplet):
   ```bash
   docker compose exec ollama ollama list
   docker compose exec ollama ollama pull qwen2.5-coder:7b   # example
   ```
2. **Create an `opencode_local` agent** with:
   - `model`: `ollama/qwen2.5-coder:7b`  (provider/model format)
   - `env`: `{ "OLLAMA_HOST": "http://ollama:11434" }`

   Confirm OpenCode's exact Ollama env/provider knob against current OpenCode
   docs before first run (`OLLAMA_HOST` vs a provider-config entry).

⚠️ Local Ollama models are far weaker than Claude/Codex — use for cheap,
background, or simple agents, not your main driver.
