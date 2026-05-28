#!/usr/bin/env bash
# infra/scripts/benchmark-ollama-embed.sh
#
# Benchmarks Ollama embedding model candidates on a sample document.
# For each model: pulls it, times a single /api/embeddings call, prints
# the latency in ms and the embedding dimensionality.
#
# Usage: benchmark-ollama-embed.sh [sample_file]
#   sample_file defaults to /opt/vault/skills/sample.md

set -euo pipefail

MODELS=("nomic-embed-text" "bge-large" "mxbai-embed-large")
SAMPLE_FILE="${1:-/opt/vault/skills/sample.md}"

if [[ ! -f "${SAMPLE_FILE}" ]]; then
  echo "Sample file not found: ${SAMPLE_FILE}" >&2
  exit 1
fi

PROMPT_JSON=$(jq -Rs . < "${SAMPLE_FILE}")

for m in "${MODELS[@]}"; do
  echo "=== ${m} ==="
  ollama pull "${m}" >/dev/null
  start=$(date +%s%3N)
  resp=$(curl -s http://localhost:11434/api/embeddings \
    -d "{\"model\":\"${m}\",\"prompt\":${PROMPT_JSON}}")
  end=$(date +%s%3N)
  dim=$(echo "${resp}" | jq '.embedding | length')
  echo "  latency_ms=$((end - start))  dim=${dim}"
done
