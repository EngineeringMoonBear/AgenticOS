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

## GitHub — push + PR via the AgenticOS Developer App

You authenticate to GitHub through a **GitHub App** (installation tokens), not a
personal token. It spans every org the App is installed on (EngineeringMoonBear,
Goldberry-Playground, …).

- **`git` just works.** `git clone`, `fetch`, and `push` over `https://github.com/…`
  are authed automatically by a credential helper that mints a short-lived token
  for that repo's owner. No setup, no token handling.
- **Always branch + PR — never push to `main`.** Open a PR for review.
- **For `gh` or raw GitHub API calls**, mint a token for the repo's owner first:
  ```bash
  TOKEN=$(node /paperclip/agent-git/github-app-token.mjs token <owner>)
  # then, e.g.:
  GH_TOKEN="$TOKEN" gh pr create --base main --head <branch> --title "…" --body "…"
  # or via the API directly:
  curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/<owner>/<repo>/pulls -d '{"title":"…","head":"<branch>","base":"main","body":"…"}'
  ```
  `<owner>` is the org/user in the repo path (e.g. `goldberry-playground`,
  `EngineeringMoonBear`). Tokens last ~1h and are cached, so re-running is cheap.
- **Scope:** the App grants Contents + Pull requests (+ Workflows). No admin, no
  secrets. If a push 404s/403s, the App likely isn't installed on that owner, or
  that repo wasn't selected in the installation — say so rather than retrying.
