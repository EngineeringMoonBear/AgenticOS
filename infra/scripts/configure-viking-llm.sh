#!/usr/bin/env bash
# infra/scripts/configure-viking-llm.sh
#
# Idempotently writes OpenViking's config.yaml to point its embedding and
# VLM providers at the local Ollama OpenAI-compatible endpoint. Safe to
# re-run: exits 0 with "no change" if the file already matches.
#
# Env vars:
#   VIKING_CONFIG_PATH  default /opt/viking/config.yaml
#   EMBED_MODEL         default nomic-embed-text
#   VLM_MODEL           default qwen2.5:7b

set -euo pipefail

VIKING_CONFIG_PATH="${VIKING_CONFIG_PATH:-/opt/viking/config.yaml}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
VLM_MODEL="${VLM_MODEL:-qwen2.5:7b}"

DESIRED=$(cat <<EOF
embedding:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: ${EMBED_MODEL}
vlm:
  api_base: http://ollama:11434/v1
  api_key: dummy
  provider: openai
  model: ${VLM_MODEL}
EOF
)

if [[ -f "${VIKING_CONFIG_PATH}" ]] && diff -q <(echo "${DESIRED}") "${VIKING_CONFIG_PATH}" >/dev/null 2>&1; then
  echo "Viking config already correct — no change."
  exit 0
fi

mkdir -p "$(dirname "${VIKING_CONFIG_PATH}")"
echo "${DESIRED}" > "${VIKING_CONFIG_PATH}"
echo "Wrote Viking config to ${VIKING_CONFIG_PATH}"
echo "Restart Viking: docker compose -f /opt/agenticos/docker-compose.yml restart openviking"
