"""codex exec --json subprocess wrapper.

Invocation pattern from spec1-verified-api-shapes.md §2:
  echo "<prompt>" | codex exec --json --skip-git-repo-check \
                                --sandbox read-only \
                                --dangerously-bypass-approvals-and-sandbox \
                                --model <model>

JSONL events parsed:
  thread.started      → thread_id (informational)
  turn.started        → marker
  item.completed      → if item.type == "agent_message", append item.text
  turn.completed      → usage dict (input/cached_input/output/reasoning tokens)
  error / turn.failed → raise RuntimeError with the message

Auth: requires `codex login --with-api-key` to have been run once; auth
persists in ~/.codex/auth.json. Cloud-init Task 4 already handles this.
"""
import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CODEX_DEFAULT_MODEL = os.environ.get("CODEX_DEFAULT_MODEL", "gpt-5-codex")
WORK_ROOT = Path(os.environ.get("AGENTICOS_WORK_ROOT", "/opt/agenticos/work"))


@dataclass(frozen=True)
class CodexResult:
    text: str
    model: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_output_tokens: int
    latency_ms: int


def run_codex(*, prompt: str, task_id: str,
              model: str = CODEX_DEFAULT_MODEL,
              timeout_sec: int = 600) -> CodexResult:
    sandbox = WORK_ROOT / task_id
    sandbox.mkdir(parents=True, exist_ok=True)

    cmd = [
        CODEX_BIN, "exec", "--json",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model", model,
    ]
    start = time.monotonic()
    proc = subprocess.run(
        cmd, input=prompt, capture_output=True, text=True,
        cwd=sandbox, timeout=timeout_sec, env={**os.environ},
    )
    latency_ms = int((time.monotonic() - start) * 1000)

    if proc.returncode != 0:
        raise RuntimeError(
            f"Codex exited {proc.returncode}: {proc.stderr[:500]}"
        )

    text_parts: list[str] = []
    actual_model = model
    usage: dict = {}
    error_msg: str | None = None

    for line in proc.stdout.splitlines():
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        et = ev.get("type")
        if et == "item.completed":
            item = ev.get("item", {})
            if item.get("type") == "agent_message":
                text_parts.append(item.get("text", ""))
        elif et == "turn.completed":
            usage = ev.get("usage", {})
        elif et in ("error", "turn.failed"):
            msg = ev.get("error", {}).get("message") or ev.get("message", "")
            error_msg = msg

    if error_msg:
        raise RuntimeError(f"Codex turn failed: {error_msg}")

    return CodexResult(
        text="".join(text_parts),
        model=actual_model,
        input_tokens=usage.get("input_tokens", 0),
        cached_input_tokens=usage.get("cached_input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        reasoning_output_tokens=usage.get("reasoning_output_tokens", 0),
        latency_ms=latency_ms,
    )
