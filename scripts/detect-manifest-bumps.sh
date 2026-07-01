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
