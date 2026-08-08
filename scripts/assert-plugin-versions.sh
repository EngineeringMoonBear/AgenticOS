#!/usr/bin/env bash
#
# assert-plugin-versions.sh — GOL-804
#
# Post-deploy invariant check, run ON the droplet after the plugin dists are
# rebuilt. For each plugin passed (default: all five), read the freshly-built
# version from its dist and assert the LIVE registry reports that exact version
# and a healthy status. Fails RED if any plugin's registry drifted from the
# built code — the backstop that turns a silent stale deploy (GOL-804) into a
# loud failure, regardless of whether a manifest bump was detected.
#
# Usage: scripts/assert-plugin-versions.sh [<plugin> ...]
#   plugin ∈ vault-plugin | openviking-plugin | github-plugin |
#            github-sync-plugin | discord-plugin
#   (no args → assert all five)
#
# Env: see plugin-api-env.sh, plus REPO_DIR (default /opt/agenticos/repo).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-/opt/agenticos/repo}"
VALID="vault-plugin openviking-plugin github-plugin github-sync-plugin discord-plugin"

command -v node >/dev/null || { echo "FATAL: node not found on PATH" >&2; exit 1; }

plugins=("$@")
[ "${#plugins[@]}" -ge 1 ] || read -r -a plugins <<< "$VALID"
for p in "${plugins[@]}"; do
  case " ${VALID} " in
    *" ${p} "*) ;;
    *) echo "FATAL: unknown plugin '${p}' (valid: ${VALID})" >&2; exit 2 ;;
  esac
done

# shellcheck source=scripts/plugin-api-env.sh
source "${HERE}/plugin-api-env.sh"
echo "paperclip API: ${PAPERCLIP_BASE}"

# Build the <pluginKey>=<builtVersion> expectation map from the deployed dists.
expect=""
for p in "${plugins[@]}"; do
  mf="${REPO_DIR}/packages/${p}/dist/manifest.js"
  [ -s "$mf" ] || { echo "FATAL: ${p}: built manifest missing at ${mf}" >&2; exit 1; }
  v="$(grep -oE 'version:[[:space:]]*"[^"]+"' "$mf" | head -n1 | sed -E 's/.*"([^"]+)".*/\1/')"
  [ -n "$v" ] || { echo "FATAL: ${p}: could not read version from ${mf}" >&2; exit 1; }
  expect="${expect} agenticos.${p}=${v}"
done

EXPECT="${expect# }" node "${HERE}/assert-plugin-versions.mjs"
