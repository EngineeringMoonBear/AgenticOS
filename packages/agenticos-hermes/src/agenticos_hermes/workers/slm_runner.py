"""Ollama HTTP wrapper. Uses Ollama's OpenAI-compatible /v1/chat/completions
endpoint. Always returns 0 cost (handled by pricing.py's local-providers set).
"""
import os
import time
from dataclasses import dataclass
import httpx

OLLAMA_ENDPOINT = os.environ.get("OLLAMA_ENDPOINT", "http://ollama:11434")
OLLAMA_TIMEOUT = float(os.environ.get("OLLAMA_TIMEOUT", "60"))


@dataclass(frozen=True)
class SlmResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


def run_slm(*, model: str, prompt: str, system: str = "",
            temperature: float = 0.2) -> SlmResult:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    start = time.monotonic()
    with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
        resp = client.post(
            f"{OLLAMA_ENDPOINT}/v1/chat/completions",
            json={"model": model, "messages": messages,
                  "temperature": temperature, "stream": False},
        )
        resp.raise_for_status()
        data = resp.json()
    latency_ms = int((time.monotonic() - start) * 1000)

    return SlmResult(
        text=data["choices"][0]["message"]["content"],
        model=model,
        input_tokens=data.get("usage", {}).get("prompt_tokens", 0),
        output_tokens=data.get("usage", {}).get("completion_tokens", 0),
        latency_ms=latency_ms,
    )
