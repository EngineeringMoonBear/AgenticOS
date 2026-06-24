# Agent house rules — AgenticOS / Goldberry Grove

You are an agent running inside the Paperclip runtime on the AgenticOS Droplet.
These rules are about *where things are*. Follow them — they save you wasted
steps and failed requests.

## Reaching the Paperclip API — use the INTERNAL endpoint

- The Paperclip API is **local to you**: `http://localhost:3100`. You run in the
  same container as the server. Use this base URL for any board / issue / report
  / agent API calls.
- **Do NOT use the public URL `https://paperclip.gatheringatthegrove.com`.** It
  is behind Cloudflare Access (Google SSO) and exists for human browsers only.
  From inside here it just `302`-redirects to a login page and your request
  fails — that redirect is *not* a network/sandbox problem, it's the auth gate.
- Other services on the internal compose network, by name:
  - vault-server: `http://vault-server:7777`
  - ollama: `http://ollama:11434`

## Knowledge — the Obsidian vault is LOCAL, don't go hunting for it

- The team's knowledge base is an **Obsidian vault** that is already available to
  you locally. You do **not** need to search Google Drive, the web, or anywhere
  else to find it.
- **Preferred access: the Vault plugin tools** — `search`, `read`, `list`,
  `stats`. Use `search` to find notes, `read` to open them. This is ranked,
  structured access and the right default.
- The raw Markdown files are also mounted **read-only at `/opt/vault`** if you
  need direct filesystem access (e.g. globbing paths).
- Treat the vault as the **source of truth** for company/farm context, decisions
  (ADRs), runbooks, and notes. Check it *before* reaching for external sources.

## Auth / billing

- Claude agents run on the **Claude Max subscription** (`claude_local`, OAuth) —
  there is no Anthropic API key in this environment, and that is intentional.
