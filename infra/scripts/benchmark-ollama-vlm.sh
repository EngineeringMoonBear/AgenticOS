#!/usr/bin/env bash
# infra/scripts/benchmark-ollama-vlm.sh
#
# Benchmarks Ollama VLM/LLM candidates on summarization latency and output
# quality (manual eval). For each model: pulls it, times a single
# /api/generate call with an 80-token summarize prompt, prints the latency
# and the model's output.
#
# Usage: benchmark-ollama-vlm.sh [sample_file]
#   sample_file defaults to /opt/vault/skills/sample.md

set -euo pipefail

MODELS=("qwen2.5:7b" "qwen2.5:14b" "llama3.1:8b")
SAMPLE_FILE="${1:-/opt/vault/skills/sample.md}"
PROMPT="Summarize the following document in 80 tokens or fewer:"

if [[ ! -f "${SAMPLE_FILE}" ]]; then
  echo "Sample file not found: ${SAMPLE_FILE}" >&2
  exit 1
fi

INPUT="${PROMPT}

$(cat "${SAMPLE_FILE}")"

for m in "${MODELS[@]}"; do
  echo "=== ${m} ==="
  ollama pull "${m}" >/dev/null
  start=$(date +%s%3N)
  resp=$(curl -s http://localhost:11434/api/generate \
    -d "$(jq -nc --arg m "$m" --arg p "$INPUT" '{model:$m,prompt:$p,stream:false}')")
  end=$(date +%s%3N)
  text=$(echo "${resp}" | jq -r '.response')
  echo "  latency_ms=$((end - start))"
  echo "  output:"
  echo "${text}" | sed 's/^/    /'
done
