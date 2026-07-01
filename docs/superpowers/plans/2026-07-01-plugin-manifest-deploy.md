# Plugin Manifest Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plugin manifest-change deploys a single idempotent Mac command instead of a hand-run curl dance, with CI detecting bumps and telling you to run it.

**Architecture:** CI (`deploy-droplet-plugins.yml`) keeps its cheap pull+build+hot-reload and gains a committed `scripts/detect-manifest-bumps.sh` step that git-diffs each plugin's `manifest.ts` and emits `MANIFEST_BUMP:` markers, which the runner turns into a `::warning::` + step-summary. A new Mac-run `scripts/deploy-plugin.sh <plugin…>` does recreate-guard → reinstall → config → disable/enable → assert, sharing 1Password + board-API helpers with `sync-paperclip-secrets.sh` via a new `scripts/paperclip-lib.sh`.

**Tech Stack:** Bash, jq, curl, 1Password CLI (`op`), Docker Compose (droplet), GitHub Actions.

## Global Constraints

- **Service tokens (github_token, openviking_root_api_key) and the Paperclip board key flow ONLY from 1Password, never through CI.** CI holds the SSH deploy key only.
- **Repo:** `EngineeringMoonBear/AgenticOS`. Work on branch `plugin-manifest-deploy`.
- **Plugins (4):** `vault-plugin`, `openviking-plugin`, `github-plugin`, `github-sync-plugin`. pluginKey = `agenticos.<name>`. Compose mounts each at `/paperclip/plugins/<name>` (read-only). Manifest source at `packages/<name>/src/manifest.ts`.
- **Paperclip API:** board-authed (`Authorization: Bearer <pcp_board_...>`). Reached from the Mac via SSH tunnel at `http://localhost:3100`. `GET /api/plugins` returns a bare array (or `{plugins:[…]}` — handle both with `.plugins // .`). Install: `POST /api/plugins/install {packageName, isLocalPath:true}` → PluginRecord (`status:"ready"`); won't update in place. `DELETE /api/plugins/:id`. `POST /api/plugins/:id/config {configJson}`. `POST /api/plugins/:id/disable`, `POST /api/plugins/:id/enable`.
- **Commits:** signing hangs in the automation shell (1Password SSH agent) — commit with `-c commit.gpgsign=false` here; a pre-commit shim needs `PRE_COMMIT_ALLOW_NO_CONFIG=1`. Josh re-signs from his terminal if needed. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Never print secret values.** Config tokens are supplied inline to `jq`, never echoed.
- **Droplet-dependent steps are verified manually** (require the tunnel + `op` + board key, which can't run in this automation shell). Those steps give exact commands + expected output for Josh to run.

---

### Task 1: `scripts/detect-manifest-bumps.sh` (CI bump detection, fully testable)

**Files:**
- Create: `scripts/detect-manifest-bumps.sh`
- Test: `scratchpad` throwaway git repo (see Step 1)

**Interfaces:**
- Produces: CLI `detect-manifest-bumps.sh <OLD_REF> <NEW_REF>` — run from repo root; prints one line `MANIFEST_BUMP: <plugin>` per plugin whose `packages/<plugin>/src/manifest.ts` differs between the refs; prints nothing when no manifest changed. Exit 0 either way.

- [ ] **Step 1: Write the failing test**

Create `/private/tmp/claude-501/-Users-joshuadunbar-Documents-Dev-Projects/bbae55cc-9d5f-4622-acac-193f9bc563db/scratchpad/test-detect.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT="/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/scripts/detect-manifest-bumps.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q && git config user.email t@t && git config user.name t
for p in vault-plugin openviking-plugin github-plugin github-sync-plugin; do
  mkdir -p "packages/$p/src"
  printf 'manifest v1\n' > "packages/$p/src/manifest.ts"
  printf 'worker v1\n'  > "packages/$p/src/worker.ts"
done
git add -A && git commit -qm base
OLD="$(git rev-parse HEAD)"
# change ONE manifest and ONE unrelated worker
printf 'manifest v2\n' > packages/github-plugin/src/manifest.ts
printf 'worker v2\n'   > packages/vault-plugin/src/worker.ts
git add -A && git commit -qm change
OUT="$(bash "$SCRIPT" "$OLD" HEAD)"
echo "--- output ---"; echo "$OUT"
[ "$OUT" = "MANIFEST_BUMP: github-plugin" ] || { echo "FAIL: expected only github-plugin marker"; exit 1; }
# no-op case: same ref twice => no output
OUT2="$(bash "$SCRIPT" HEAD HEAD)"
[ -z "$OUT2" ] || { echo "FAIL: expected no markers for no-op, got: $OUT2"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash "/private/tmp/claude-501/-Users-joshuadunbar-Documents-Dev-Projects/bbae55cc-9d5f-4622-acac-193f9bc563db/scratchpad/test-detect.sh"`
Expected: FAIL — `detect-manifest-bumps.sh: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/detect-manifest-bumps.sh`:

```bash
#!/usr/bin/env bash
#
# detect-manifest-bumps.sh OLD_REF NEW_REF
#
# Print "MANIFEST_BUMP: <plugin>" for each AgenticOS plugin whose manifest
# SOURCE changed between OLD_REF and NEW_REF. Run from the repo root. No output
# means no manifest change — the cheap hot-reload path is sufficient.
#
# Detection = ANY diff to packages/<plugin>/src/manifest.ts (not just the
# `version:` line), so a real manifest change is never missed even if the
# author forgot to bump the version. A comment-only edit will false-positive,
# which is harmless: it only suggests running an idempotent script.
set -euo pipefail

OLD="${1:?usage: detect-manifest-bumps.sh OLD_REF NEW_REF}"
NEW="${2:?usage: detect-manifest-bumps.sh OLD_REF NEW_REF}"

for p in vault-plugin openviking-plugin github-plugin github-sync-plugin; do
  if ! git diff --quiet "$OLD" "$NEW" -- "packages/${p}/src/manifest.ts"; then
    echo "MANIFEST_BUMP: ${p}"
  fi
done
```

Then `chmod +x scripts/detect-manifest-bumps.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash "/private/tmp/claude-501/-Users-joshuadunbar-Documents-Dev-Projects/bbae55cc-9d5f-4622-acac-193f9bc563db/scratchpad/test-detect.sh"`
Expected: prints `MANIFEST_BUMP: github-plugin` then `PASS`.

- [ ] **Step 5: Lint**

Run: `bash -n scripts/detect-manifest-bumps.sh && { command -v shellcheck >/dev/null && shellcheck scripts/detect-manifest-bumps.sh || echo "shellcheck not installed — skipped"; }`
Expected: no syntax errors; shellcheck clean (or skipped).

- [ ] **Step 6: Commit**

```bash
cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS"
git add scripts/detect-manifest-bumps.sh
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(deploy): detect-manifest-bumps.sh for CI manifest-change detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `scripts/paperclip-lib.sh` + refactor `sync-paperclip-secrets.sh`

Extract the 1Password + board-API helpers into a sourced lib so `deploy-plugin.sh` (Task 3) and `sync-paperclip-secrets.sh` share one implementation. `sync-paperclip-secrets.sh`'s observable behavior is unchanged.

**Files:**
- Create: `scripts/paperclip-lib.sh`
- Modify: `scripts/sync-paperclip-secrets.sh` (replace inline helpers with `source`)
- Test: source-smoke in a subshell (below)

**Interfaces:**
- Produces (from `paperclip-lib.sh`, all sourced):
  - env defaults: `PAPERCLIP_BASE`, `OP_ITEM`, `OP_VAULT`, `OP_FIELD_BOARD_KEY`, `OP_FIELD_GITHUB`, `OP_FIELD_OPENVIKING`, `GITHUB_ORG`
  - `pc_require_tools` → exits non-zero if `op`/`jq`/`curl` missing
  - `op_read <field>` → echoes a 1Password field value
  - `pc_load_board_key` → sets global `PC_BOARD_KEY` from 1Password (idempotent)
  - `api <METHOD> <PATH> [JSON]` → board-authed curl (needs `PC_BOARD_KEY`)
  - `resolve_plugin_id <pluginKey>` → echoes the plugin id or empty
  - `configure_github` → reads github token from 1Password, POSTs github-plugin config
  - `configure_openviking` → reads openviking key from 1Password, POSTs openviking-plugin config
- Consumed by: Task 3 (`deploy-plugin.sh`) and the refactored `sync-paperclip-secrets.sh`.

- [ ] **Step 1: Write the source-smoke test**

Create `scratchpad/test-lib.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
LIB="/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/scripts/paperclip-lib.sh"
# Source in a subshell and assert every public function/var is defined.
# shellcheck disable=SC1090
source "$LIB"
for fn in pc_require_tools op_read pc_load_board_key api resolve_plugin_id configure_github configure_openviking; do
  declare -F "$fn" >/dev/null || { echo "FAIL: $fn not defined"; exit 1; }
done
[ "$PAPERCLIP_BASE" = "http://localhost:3100" ] || { echo "FAIL: PAPERCLIP_BASE default"; exit 1; }
[ "$GITHUB_ORG" = "EngineeringMoonBear" ]        || { echo "FAIL: GITHUB_ORG default"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scratchpad/test-lib.sh`
Expected: FAIL — `paperclip-lib.sh: No such file or directory`.

- [ ] **Step 3: Write `scripts/paperclip-lib.sh`**

```bash
#!/usr/bin/env bash
#
# paperclip-lib.sh — shared helpers for Paperclip plugin management scripts.
# SOURCE this (don't execute). Used by sync-paperclip-secrets.sh and
# deploy-plugin.sh. Reads credentials from 1Password and talks to the Paperclip
# board API. NEVER prints a secret value.
#
# Requires: op, jq, curl (assert with pc_require_tools).
# Env defaults (override before sourcing or in the caller's environment):

PAPERCLIP_BASE="${PAPERCLIP_BASE:-http://localhost:3100}"
OP_ITEM="${OP_ITEM:-AgenticOS Infra}"
OP_VAULT="${OP_VAULT:-Goldberry Grove - Admin}"
OP_FIELD_BOARD_KEY="${OP_FIELD_BOARD_KEY:-paperclip_board_key}"
OP_FIELD_GITHUB="${OP_FIELD_GITHUB:-github_token}"
OP_FIELD_OPENVIKING="${OP_FIELD_OPENVIKING:-openviking_root_api_key}"
GITHUB_ORG="${GITHUB_ORG:-EngineeringMoonBear}"

pc_require_tools() {
  command -v op   >/dev/null || { echo "FATAL: 1Password CLI 'op' not found" >&2; exit 1; }
  command -v jq   >/dev/null || { echo "FATAL: 'jq' not found" >&2; exit 1; }
  command -v curl >/dev/null || { echo "FATAL: 'curl' not found" >&2; exit 1; }
}

op_read() { op read "op://${OP_VAULT}/${OP_ITEM}/$1"; }

# pc_load_board_key — read the board key into PC_BOARD_KEY once (memory only).
pc_load_board_key() {
  [ -n "${PC_BOARD_KEY:-}" ] && return 0
  PC_BOARD_KEY="$(op_read "${OP_FIELD_BOARD_KEY}")"
  [ -n "${PC_BOARD_KEY}" ] || { echo "FATAL: board key empty" >&2; exit 1; }
}

# api METHOD PATH [JSON-BODY] — board-authed curl. Requires PC_BOARD_KEY.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H "Authorization: Bearer ${PC_BOARD_KEY}" \
      -H "Content-Type: application/json" -d "$body" "${PAPERCLIP_BASE}${path}"
  else
    curl -fsS -X "$method" -H "Authorization: Bearer ${PC_BOARD_KEY}" \
      "${PAPERCLIP_BASE}${path}"
  fi
}

# resolve_plugin_id PLUGINKEY — echoes the plugin id, or empty if not installed.
resolve_plugin_id() {
  api GET /api/plugins | jq -r --arg k "$1" \
    '(.plugins // .)[] | select(.pluginKey==$k) | .id'
}

# configure_github — POST github-plugin config (token read from 1Password,
# supplied inline to jq, never echoed).
configure_github() {
  local id token cfg
  token="$(op_read "${OP_FIELD_GITHUB}")"
  [ -n "$token" ] || { echo "FATAL: github token empty" >&2; return 1; }
  id="$(resolve_plugin_id agenticos.github-plugin)"
  [ -n "$id" ] || { echo "FATAL: github-plugin not installed" >&2; return 1; }
  cfg="$(jq -nc --arg t "$token" --arg org "$GITHUB_ORG" \
    '{configJson:{githubToken:$t, org:$org, staleDays:7, vaultPath:"wiki/_meta/dev-pr-digest.md", vaultServerUrl:"http://vault-server:7777"}}')"
  api POST "/api/plugins/${id}/config" "$cfg" >/dev/null
  echo "    github-plugin config set"
}

# configure_openviking — POST openviking-plugin config (key from 1Password).
configure_openviking() {
  local id key cfg
  key="$(op_read "${OP_FIELD_OPENVIKING}")"
  [ -n "$key" ] || { echo "FATAL: openviking key empty" >&2; return 1; }
  id="$(resolve_plugin_id agenticos.openviking-plugin)"
  [ -n "$id" ] || { echo "FATAL: openviking-plugin not installed" >&2; return 1; }
  cfg="$(jq -nc --arg k "$key" \
    '{configJson:{apiKey:$k, endpoint:"http://openviking:1933", account:"agenticos", user:"deploy"}}')"
  api POST "/api/plugins/${id}/config" "$cfg" >/dev/null
  echo "    openviking-plugin config set"
}
```

- [ ] **Step 4: Run source-smoke to verify it passes**

Run: `bash scratchpad/test-lib.sh`
Expected: `PASS`.

- [ ] **Step 5: Refactor `sync-paperclip-secrets.sh` to source the lib**

Replace lines 38–101 of `scripts/sync-paperclip-secrets.sh` (from `set -euo pipefail` through the openviking config POST) so the script sources the lib and reuses its functions. The new body (keep the file's header comment block above line 38 intact, and keep the pr-triage trigger block below):

```bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"

GITHUB_ORG="${GITHUB_ORG:-EngineeringMoonBear}"
TRIGGER_TRIAGE="${TRIGGER_TRIAGE:-0}"

pc_require_tools
pc_load_board_key

echo "==> 1/3 refreshing plugins (delete + reinstall to pick up new manifests)"
existing="$(api GET /api/plugins)"
echo "$existing" | jq -r '(.plugins // .)[] | select(.pluginKey|startswith("agenticos.")) | .id' \
  | while read -r id; do
      [ -n "$id" ] && api DELETE "/api/plugins/${id}" >/dev/null && echo "    deleted ${id}"
    done
# github-sync-plugin is installed here but configured separately (write-scoped
# token + synced project id); see docs/runbooks/github-issue-sync.md. Until
# configured it stays INACTIVE (the worker refuses to subscribe unscoped).
for name in vault-plugin openviking-plugin github-plugin github-sync-plugin; do
  status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${name}\",\"isLocalPath\":true}" \
    | jq -r '.status')"
  echo "    installed ${name} -> ${status}"
done

echo "==> 2/3 setting plugin config (token values supplied inline by jq, not echoed)"
configure_github
configure_openviking
```

Leave the existing `if [ "${TRIGGER_TRIAGE}" = "1" ]; then … fi` block (pr-triage trigger) and the final `echo "==> done…"` in place — they already use `api` from the lib. Note `gh_id` is referenced by the trigger block; add this line just before that `if`:

```bash
gh_id="$(resolve_plugin_id agenticos.github-plugin)"
```

- [ ] **Step 6: Lint the refactor**

Run: `cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS" && bash -n scripts/sync-paperclip-secrets.sh scripts/paperclip-lib.sh && { command -v shellcheck >/dev/null && shellcheck -x scripts/sync-paperclip-secrets.sh scripts/paperclip-lib.sh || echo "shellcheck skipped"; }`
Expected: no syntax errors; shellcheck clean (or skipped). `-x` follows the `source`.

- [ ] **Step 7: Commit**

```bash
git add scripts/paperclip-lib.sh scripts/sync-paperclip-secrets.sh
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "refactor(deploy): extract paperclip-lib.sh; sync-secrets sources it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `scripts/deploy-plugin.sh` (idempotent Mac-run manifest deploy)

**Files:**
- Create: `scripts/deploy-plugin.sh`
- Test: arg-validation paths (runnable locally); runtime path verified manually.

**Interfaces:**
- Consumes: everything from `paperclip-lib.sh` (Task 2).
- Produces: CLI `deploy-plugin.sh <plugin> [<plugin> …]`. Per plugin: recreate-guard → reinstall → apply config → disable/enable → assert healthy. Exits non-zero on unknown plugin (usage, code 2) or an unhealthy plugin after deploy.

- [ ] **Step 1: Write the arg-validation test (runs without a droplet)**

Create `scratchpad/test-deploy-plugin-args.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
S="/Users/joshuadunbar/Documents/Dev Projects/AgenticOS/scripts/deploy-plugin.sh"
# no args => usage, exit 2
bash "$S" >/dev/null 2>&1; [ "$?" -eq 2 ] || { echo "FAIL: no-arg should exit 2"; exit 1; }
# unknown plugin => exit 2, before any op/ssh call
out="$(bash "$S" not-a-plugin 2>&1)"; rc=$?
[ "$rc" -eq 2 ] || { echo "FAIL: unknown plugin should exit 2"; exit 1; }
echo "$out" | grep -q "unknown plugin" || { echo "FAIL: expected 'unknown plugin' message"; exit 1; }
echo "PASS"
```

Note: arg validation happens before `pc_require_tools`/SSH, so this runs anywhere.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scratchpad/test-deploy-plugin-args.sh`
Expected: FAIL — `deploy-plugin.sh: No such file or directory`.

- [ ] **Step 3: Write `scripts/deploy-plugin.sh`**

```bash
#!/usr/bin/env bash
#
# deploy-plugin.sh — finish a manifest-change deploy for one or more AgenticOS
# plugins. Run from the Mac, exactly like sync-paperclip-secrets.sh:
#   - `op` signed in (`op signin`)
#   - SSH tunnel to Paperclip open:
#       ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
# Idempotent: safe to re-run.
#
# Per plugin:
#   1. recreate-guard — force-recreate paperclip-server ONLY if the plugin dir
#      isn't visible in the container yet (a newly-added bind mount)
#   2. delete + reinstall — refreshes the stored manifest (install won't update)
#   3. apply config from 1Password — github/openviking only; vault has none;
#      github-sync is configured via its own runbook
#   4. disable -> enable — forces the worker setup() to re-run with fresh config
#   5. assert — plugin present and not in an error state
#
# Usage: scripts/deploy-plugin.sh <plugin> [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin | github-sync-plugin
#
# Env: as paperclip-lib.sh, plus:
#   DROPLET_SSH   default "deploy@agenticos-droplet"  (recreate-guard SSH target)
#   COMPOSE_DIR   default "/opt/agenticos"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/paperclip-lib.sh
source "${HERE}/paperclip-lib.sh"

DROPLET_SSH="${DROPLET_SSH:-deploy@agenticos-droplet}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agenticos}"
VALID_PLUGINS="vault-plugin openviking-plugin github-plugin github-sync-plugin"

usage() {
  echo "Usage: $0 <plugin> [<plugin> ...]" >&2
  echo "  plugin ∈ ${VALID_PLUGINS}" >&2
  exit 2
}

# --- validate args BEFORE touching op/ssh so bad input fails fast & offline ---
[ "$#" -ge 1 ] || usage
for p in "$@"; do
  case " ${VALID_PLUGINS} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}'" >&2; usage ;;
  esac
done

pc_require_tools
command -v ssh >/dev/null || { echo "FATAL: 'ssh' not found" >&2; exit 1; }
pc_load_board_key

# recreate_guard PLUGIN — recreate paperclip-server iff the plugin dir is not
# yet visible in the container. Idempotent (skips when the mount resolves).
recreate_guard() {
  local p="$1" i
  if ssh "${DROPLET_SSH}" \
       "cd ${COMPOSE_DIR} && docker compose exec -T paperclip-server test -s /paperclip/plugins/${p}/package.json" \
       >/dev/null 2>&1; then
    echo "    ${p}: mount already resolved (no recreate)"
    return 0
  fi
  echo "    ${p}: mount missing in container -> force-recreate paperclip-server"
  ssh "${DROPLET_SSH}" \
    "cd ${COMPOSE_DIR} && docker compose up -d --force-recreate paperclip-server"
  for i in $(seq 1 30); do
    if api GET /api/plugins >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "FATAL: ${p}: API did not come back after recreate" >&2
  return 1
}

# reinstall PLUGIN — delete (if present) then install fresh.
reinstall() {
  local p="$1" id status
  id="$(resolve_plugin_id "agenticos.${p}")"
  if [ -n "$id" ]; then
    api DELETE "/api/plugins/${id}" >/dev/null && echo "    ${p}: deleted ${id}"
  fi
  status="$(api POST /api/plugins/install \
    "{\"packageName\":\"/paperclip/plugins/${p}\",\"isLocalPath\":true}" \
    | jq -r '.status')"
  echo "    ${p}: installed -> ${status}"
}

# apply_config PLUGIN — push config from 1Password for plugins that take it.
apply_config() {
  local p="$1"
  case "$p" in
    github-plugin)      configure_github ;;
    openviking-plugin)  configure_openviking ;;
    vault-plugin)       echo "    ${p}: no config" ;;
    github-sync-plugin) echo "    ${p}: config deferred -> see docs/runbooks/github-issue-sync.md" ;;
  esac
}

# cycle PLUGIN — disable then enable to force setup() to re-run.
cycle() {
  local p="$1" id
  id="$(resolve_plugin_id "agenticos.${p}")"
  [ -n "$id" ] || { echo "FATAL: ${p} missing after install" >&2; return 1; }
  api POST "/api/plugins/${id}/disable" >/dev/null 2>&1 || true
  api POST "/api/plugins/${id}/enable"  >/dev/null
  echo "    ${p}: disabled+enabled"
}

# assert_healthy PLUGIN — print status; fail on an error/empty state.
assert_healthy() {
  local p="$1" status
  status="$(api GET /api/plugins | jq -r --arg k "agenticos.${p}" \
    '(.plugins // .)[] | select(.pluginKey==$k) | .status')"
  echo "    ${p}: status=${status}"
  case "$status" in
    error|failed|"") echo "FATAL: ${p} not healthy (status='${status}')" >&2; return 1 ;;
  esac
}

for p in "$@"; do
  echo "==> ${p}"
  recreate_guard "$p"
  reinstall "$p"
  apply_config "$p"
  cycle "$p"
  assert_healthy "$p"
done
echo "==> done. Plugins refreshed from 1Password: $*"
```

Then `chmod +x scripts/deploy-plugin.sh`.

- [ ] **Step 4: Run arg test to verify it passes**

Run: `bash scratchpad/test-deploy-plugin-args.sh`
Expected: `PASS`.

- [ ] **Step 5: Lint**

Run: `cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS" && bash -n scripts/deploy-plugin.sh && { command -v shellcheck >/dev/null && shellcheck -x scripts/deploy-plugin.sh || echo "shellcheck skipped"; }`
Expected: no syntax errors; shellcheck clean (or skipped).

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy-plugin.sh
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "feat(deploy): idempotent deploy-plugin.sh for manifest changes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire detection into `deploy-droplet-plugins.yml` + rewrite header

**Files:**
- Modify: `.github/workflows/deploy-droplet-plugins.yml`
- Test: YAML parse + a local simulation of the marker→warning mapping.

**Interfaces:**
- Consumes: `scripts/detect-manifest-bumps.sh` (Task 1), present on the droplet checkout after `git reset --hard`.
- Produces: on a manifest change, a `::warning::` per plugin + `$GITHUB_STEP_SUMMARY` lines; on a clean deploy, a "no manifest changes" summary line. Job still succeeds either way.

- [ ] **Step 1: Rewrite the header comment (lines 1–18)**

Replace the top comment block with:

```yaml
# Deploy Droplet Plugins
#
# Auto-deploys the Paperclip plugins on push to main when any plugin source
# changes. Companion to deploy-droplet.yml (which handles vault-server).
#
# CHEAP PATH (worker code changes): git-pull the repo + rebuild the dists in
# place. Paperclip's plugin-dev-watcher HOT-RELOADS each worker whose dist/
# changed — no restart, no manual step.
#
# MANIFEST CHANGES (new capability / config field / database / webhook): the
# hot-reload refreshes worker CODE but NOT the stored manifest. This workflow
# DETECTS a manifest change (scripts/detect-manifest-bumps.sh diffs
# packages/<p>/src/manifest.ts across the deploy) and emits a ::warning:: +
# job-summary telling you to finish it from a Mac:
#     scripts/deploy-plugin.sh <plugin>
# which does recreate-guard -> reinstall -> config -> enable. CI cannot do this
# itself: applying plugin config needs the service tokens, and tokens flow ONLY
# from 1Password, never through CI. See docs/runbooks/deploy-plugin-manifest-change.md.
#
# Convention: bump `version:` in the manifest on every manifest change. (CI
# detects by whole-file diff, so a forgotten bump is still caught.)
```

- [ ] **Step 2: Add OLD-SHA capture + detection call to the build step**

In the step `Pull repo + rebuild plugin dists (hot-reloads workers)` (currently lines 56–95), (a) capture the pre-reset SHA, (b) run the detector at the end, and (c) tee the whole SSH output to `deploy.log` so the next step can grep markers. Change the step so the `run:` is:

```yaml
      - name: Pull repo + rebuild plugin dists (hot-reloads workers)
        env:
          HOST: ${{ secrets.DROPLET_HOST }}
          USER: ${{ secrets.DROPLET_USER }}
        run: |
          # bash -lc → login shell so pnpm/node are on PATH.
          ssh -i ~/.ssh/deploy_key "${USER}@${HOST}" 'bash -lc '"'"'
            set -euo pipefail

            # Self-heal the packages symlink (stale REAL dir shadows the repo).
            if [ -e /opt/agenticos/packages ] && [ ! -L /opt/agenticos/packages ]; then
              rm -rf /opt/agenticos/packages
            fi
            ln -sfn /opt/agenticos/repo/packages /opt/agenticos/packages

            cd /opt/agenticos/repo
            OLD="$(git rev-parse HEAD)"
            git fetch --quiet origin main
            git checkout --quiet main
            git reset --hard --quiet origin/main

            pnpm install --frozen-lockfile \
              --filter @agenticos/vault-plugin \
              --filter @agenticos/openviking-plugin \
              --filter @agenticos/github-plugin \
              --filter @agenticos/github-sync-plugin
            pnpm --filter @agenticos/vault-plugin \
                 --filter @agenticos/openviking-plugin \
                 --filter @agenticos/github-plugin \
                 --filter @agenticos/github-sync-plugin build

            # Fail the deploy if any dist is incomplete (worker + manifest).
            for p in vault-plugin openviking-plugin github-plugin github-sync-plugin; do
              for f in dist/worker.js dist/manifest.js; do
                test -s "packages/$p/$f" || { echo "MISSING packages/$p/$f"; exit 1; }
              done
              echo "ok: $p"
            done

            echo "=== manifest bump detection ==="
            bash scripts/detect-manifest-bumps.sh "$OLD" HEAD
          '"'"'' | tee deploy.log
```

(The runner default shell is `bash -eo pipefail`, so `ssh … | tee` still fails the step if the SSH command fails.)

- [ ] **Step 3: Add the warn-and-summarize step**

Insert this step immediately after the build step and before `Confirm workers hot-reloaded`:

```yaml
      - name: Warn on manifest changes
        if: always()
        run: |
          grep "^MANIFEST_BUMP:" deploy.log > bumps.txt || true
          if [ -s bumps.txt ]; then
            echo "### ⚠️ Manifest changes need a manual finish" >> "$GITHUB_STEP_SUMMARY"
            while read -r _ plugin; do
              echo "::warning title=Manifest changed::${plugin}: worker code hot-reloaded, but the stored manifest is stale. Run scripts/deploy-plugin.sh ${plugin} from a Mac (op signed in + SSH tunnel) to reinstall, reapply config, and enable."
              echo "- **${plugin}** — run \`scripts/deploy-plugin.sh ${plugin}\` from a Mac to finish (reinstall + config + enable)." >> "$GITHUB_STEP_SUMMARY"
            done < bumps.txt
          else
            echo "No manifest changes — workers hot-reloaded (cheap path)." >> "$GITHUB_STEP_SUMMARY"
          fi
```

- [ ] **Step 4: Validate the YAML parses**

Run: `cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS" && python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-droplet-plugins.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 5: Simulate the marker→warning mapping locally**

Run:
```bash
printf 'ok: vault-plugin\nMANIFEST_BUMP: github-plugin\nMANIFEST_BUMP: openviking-plugin\n' > /tmp/deploy.log
grep "^MANIFEST_BUMP:" /tmp/deploy.log | while read -r _ plugin; do echo "would warn: $plugin"; done
```
Expected: two lines — `would warn: github-plugin`, `would warn: openviking-plugin`. Confirms the `read -r _ plugin` split picks the plugin name.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy-droplet-plugins.yml
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "ci(deploy): detect manifest changes and warn to run deploy-plugin.sh

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Runbook `docs/runbooks/deploy-plugin-manifest-change.md`

**Files:**
- Create: `docs/runbooks/deploy-plugin-manifest-change.md`

**Interfaces:** none (docs). Cross-links the workflow, `deploy-plugin.sh`, and the contract memory.

- [ ] **Step 1: Write the runbook**

```markdown
# Runbook: finish a plugin manifest-change deploy

## When you need this

You pushed a **manifest change** to a plugin (new capability, config field,
`database:`, or `webhooks:` declaration in `packages/<plugin>/src/manifest.ts`)
and the `Deploy Droplet Plugins` GitHub Actions run posted a ⚠️ warning like:

> **github-sync-plugin** — run `scripts/deploy-plugin.sh github-sync-plugin`
> from a Mac to finish (reinstall + config + enable).

CI hot-reloaded the worker **code** but cannot refresh the **stored manifest**
(that needs a reinstall) or reapply config (that needs the service tokens, which
live only in 1Password — never in CI). You finish it from your Mac.

## Prerequisites

- `op` (1Password CLI) signed in: `op signin`
- SSH tunnel to Paperclip open:
  ```sh
  ssh -fNL 3100:10.116.16.2:3100 deploy@<droplet>
  ```
- SSH access to the droplet as `deploy@agenticos-droplet` (for the recreate-guard).

## Do it

```sh
cd /path/to/AgenticOS
scripts/deploy-plugin.sh <plugin>        # e.g. github-sync-plugin
# multiple at once:
scripts/deploy-plugin.sh github-plugin openviking-plugin
```

The script is idempotent — re-run it freely. Per plugin it:

1. **recreate-guard** — force-recreates `paperclip-server` only if the plugin
   dir isn't yet visible in the container (a newly-added bind mount; the
   inode-pinning `"Missing package.json"` fix). Skips otherwise.
2. **reinstall** — `DELETE` + `POST /api/plugins/install` to refresh the stored
   manifest (install won't update in place).
3. **config** — pushes config from 1Password: `github-plugin` and
   `openviking-plugin` only. `vault-plugin` takes none. `github-sync-plugin` is
   configured via [github-issue-sync.md](github-issue-sync.md) (write-scoped
   token + synced project id) — this script reinstalls + enables it but does
   NOT set its config.
4. **disable → enable** — forces the worker `setup()` to re-run so it
   re-subscribes with the fresh config (saving config alone doesn't restart it).
5. **assert** — prints each plugin's status; exits non-zero on an error state.

## Verify

```sh
curl -fsS -H "Authorization: Bearer $(op read 'op://Goldberry Grove - Admin/AgenticOS Infra/paperclip_board_key')" \
  http://localhost:3100/api/plugins | jq '(.plugins // .)[] | {pluginKey, status}'
```

All target plugins should be present and NOT `error`/`failed`.

## Why each step is necessary

See `memory/paperclip-plugin-db-and-activation-contract.md` (the install/
activation lifecycle + bind-mount inode pinning sections). The short version:
manifest is read by the host before worker init, so a code hot-reload can't
touch it; install is create-only; config save doesn't restart the worker.

## Related

- `.github/workflows/deploy-droplet-plugins.yml` — emits the warning that sends
  you here.
- `scripts/deploy-plugin.sh` / `scripts/paperclip-lib.sh` — the implementation.
- `scripts/sync-paperclip-secrets.sh` — the "sync ALL plugins from 1Password"
  entrypoint (same lib); use it after a full rebuild rather than per-plugin.
```

- [ ] **Step 2: Verify the file and its links**

Run: `cd "/Users/joshuadunbar/Documents/Dev Projects/AgenticOS" && test -f docs/runbooks/deploy-plugin-manifest-change.md && test -f docs/runbooks/github-issue-sync.md && echo "runbook + linked runbook present"`
Expected: `runbook + linked runbook present`.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/deploy-plugin-manifest-change.md
PRE_COMMIT_ALLOW_NO_CONFIG=1 git -c commit.gpgsign=false commit -m "docs(runbook): finish a plugin manifest-change deploy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Static:** `bash -n` + `shellcheck -x` clean on all three scripts; workflow YAML parses.
- [ ] **Unit (runnable now):** `scratchpad/test-detect.sh`, `scratchpad/test-lib.sh`, `scratchpad/test-deploy-plugin-args.sh` all print `PASS`.
- [ ] **No-op deploy (manual, Josh):** push a worker-only change → the Actions run shows "No manifest changes" in the summary, no `::warning::`, workers hot-reload.
- [ ] **Bump deploy (manual, Josh):** push a manifest change → the run shows the ⚠️ warning + summary naming the plugin; run `scripts/deploy-plugin.sh <plugin>` on the Mac → ends with `status=…` healthy; re-run → recreate-guard skips, still healthy (idempotent).
- [ ] **Branch:** open a PR from `plugin-manifest-deploy` for review (do not merge to main without Josh).
```
