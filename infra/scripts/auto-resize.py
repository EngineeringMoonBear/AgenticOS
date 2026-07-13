#!/usr/bin/env python3
"""Guarded, opt-in vertical auto-resize executor (GOL-254, GOL-241 Tier 2B).

The Tier 2A advisor (rightsize-advisor.py, GOL-253) *recommends* a size and never
mutates. This is the guarded execution step: for droplets the board has explicitly
opted in (infra/config/auto-resize.json, enabled:true) AND with the global
AUTO_RESIZE_ENABLED kill-switch set, it performs a **disk-preserving, reversible**
CPU/RAM-only resize when 7-day-ish p95 sustains a breach — with full safety rails.

Design guarantees (why this is safe to land dormant):
  • DRY-RUN BY DEFAULT. It mutates only when BOTH the per-droplet `enabled:true`
    (a reviewed PR / board opt-in) AND the AUTO_RESIZE_ENABLED="1" Actions secret
    are set. The board opted agenticos-droplet in (GOL-254 decision D2,
    2026-07-13) => enabled:true; the remaining gate is the AUTO_RESIZE_ENABLED="1"
    secret, still unset, so this stays dry-run until an org-owner sets it.
  • NEVER GROWS DISK. Every resize is issued disk=false (CPU/RAM only, reversible).
    DO disk grows are one-way; automation is forbidden from touching disk.
  • HARD MIN/MAX BAND per droplet — runaway-cost cap; never resizes outside it.
  • MAINTENANCE WINDOW — the ~1-2 min power-off/resize/power-on reboot only runs
    inside the configured UTC day/hour window (a resize is downtime).
  • HYSTERESIS + COOLDOWN — separate up/down thresholds (no flap around one line),
    and a minimum time since the last resize, read statelessly from the DO actions
    API (no state file to corrupt).
  • HEALTH-CHECK GATE + ROLLBACK — after power-on the box must return the expected
    status within a timeout; on failure the executor resizes back to the previous
    slug (power-cycle-back) and announces the rollback.
  • Discord announce on every plan / action / rollback.

Credentials (Actions secrets, injected by CI, never held by any agent):
  AUTO_RESIZE_DO_TOKEN  DO token with droplet:read + droplet:write + monitoring:read
                        (falls back to DO_MONITORING_TOKEN for read-only/dry-run).
  DISCORD_WEBHOOK_URL   Grove ops webhook.

Env knobs (all optional):
  AUTO_RESIZE_ENABLED   "1" arms real mutation (still gated per-droplet). Default
                        unset => dry-run globally.
  DRY_RUN               "1" forces dry-run regardless of everything else.
  AUTO_RESIZE_CONFIG    path to the opt-in manifest (default infra/config/auto-resize.json).

Exit status: 0 on a clean advisory/execution pass (including "nothing to do");
non-zero only on an operational failure (bad token, DO API error, config error),
so a scheduled failure is a real signal. A single droplet's health-check failure
triggers rollback and is reported, but does not by itself fail the run unless the
rollback also fails (that is a page-worthy operational error).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ── Reuse the advisor's pure metric/DO/Discord helpers without editing it ──────
# rightsize-advisor.py has a hyphen so it is not importable by name; load it by
# path. This keeps the board-approved advisor untouched and avoids duplication.
_ADVISOR_PATH = Path(__file__).with_name("rightsize-advisor.py")
_spec = importlib.util.spec_from_file_location("rightsize_advisor", _ADVISOR_PATH)
advisor = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(advisor)

DO_API = advisor.DO_API
SIZE_LADDER = advisor.SIZE_LADDER
do_get = advisor.do_get
list_droplets = advisor.list_droplets
cpu_p50_p95 = advisor.cpu_p50_p95
mem_p50_p95 = advisor.mem_p50_p95
post_discord = advisor.post_discord

CONFIG_DEFAULT = "infra/config/auto-resize.json"


# ── DO write helpers (the mutating surface, guarded by every gate below) ───────
def do_post(path: str, body: dict, token: str) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{DO_API}{path}",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw else {}


def droplet_action(droplet_id: str, body: dict, token: str) -> int:
    """Issue a droplet action, return its action id."""
    resp = do_post(f"/droplets/{droplet_id}/actions", body, token)
    return int(resp.get("action", {}).get("id", 0))


def wait_action(droplet_id: str, action_id: int, token: str, timeout_s: int = 600) -> str:
    """Poll a droplet action to a terminal state. Returns 'completed'/'errored'."""
    deadline = time.time() + timeout_s
    status = "in-progress"
    while time.time() < deadline:
        data = do_get(f"/droplets/{droplet_id}/actions/{action_id}", token)
        status = data.get("action", {}).get("status", "in-progress")
        if status in ("completed", "errored"):
            return status
        time.sleep(5)
    return status


def droplet_status(droplet_id: str, token: str) -> str:
    return do_get(f"/droplets/{droplet_id}", token).get("droplet", {}).get("status", "unknown")


def last_resize_epoch(droplet_id: str, token: str) -> float | None:
    """Most-recent completed resize action's finish time (epoch), or None.

    Stateless cooldown source — we ask DO for the droplet's own action history
    instead of persisting state that could corrupt.
    """
    data = do_get(f"/droplets/{droplet_id}/actions?per_page=100", token)
    newest = None
    for a in data.get("actions", []):
        if a.get("type") != "resize":
            continue
        completed = a.get("completed_at")
        if not completed:
            continue
        # DO timestamps look like 2026-07-13T08:12:00Z
        try:
            t = time.mktime(time.strptime(completed, "%Y-%m-%dT%H:%M:%SZ"))
        except ValueError:
            continue
        if newest is None or t > newest:
            newest = t
    return newest


# ── Pure decision / gate logic (unit-testable, no network) ─────────────────────
def adjacent_slug(slug: str, direction: int) -> str | None:
    if slug not in SIZE_LADDER:
        return None
    i = SIZE_LADDER.index(slug) + direction
    return SIZE_LADDER[i] if 0 <= i < len(SIZE_LADDER) else None


def decide(cpu: tuple[float, float] | None, mem: tuple[float, float] | None,
           cfg: dict) -> tuple[str, str]:
    """Return (action, driver). action in {'bump','downsize','hold','nodata'}.

    Separate bump vs downsize thresholds ARE the hysteresis band: a box sitting
    between downsize_*_pct and bump_pct is 'hold' and will not flap.
    """
    cpu95 = cpu[1] if cpu else None
    mem95 = mem[1] if mem else None
    if cpu95 is None and mem95 is None:
        return "nodata", ""
    bump = float(cfg.get("bump_pct", 85))
    dmem = float(cfg.get("downsize_mem_pct", 30))
    dcpu = float(cfg.get("downsize_cpu_pct", 20))
    if (mem95 is not None and mem95 >= bump):
        return "bump", "mem"
    if (cpu95 is not None and cpu95 >= bump):
        return "bump", "cpu"
    cold = (mem95 is not None and mem95 < dmem) and (cpu95 is not None and cpu95 < dcpu)
    if cold:
        return "downsize", "idle"
    return "hold", ""


def bounded_target(slug: str, action: str, cfg: dict) -> str | None:
    """Target slug one tier in the action's direction, clamped to the band.

    Returns None if already at the band edge (nothing to do) or slug unknown.
    """
    direction = 1 if action == "bump" else -1 if action == "downsize" else 0
    if direction == 0:
        return None
    target = adjacent_slug(slug, direction)
    if target is None:
        return None
    min_slug = cfg.get("min_slug")
    max_slug = cfg.get("max_slug")
    if min_slug in SIZE_LADDER and SIZE_LADDER.index(target) < SIZE_LADDER.index(min_slug):
        return None
    if max_slug in SIZE_LADDER and SIZE_LADDER.index(target) > SIZE_LADDER.index(max_slug):
        return None
    return target


def within_window(now: time.struct_time, window: dict) -> bool:
    """UTC maintenance-window check. Empty day/hour lists => always allowed."""
    days = window.get("utc_days") or []
    hours = window.get("utc_hours") or []
    if days and now.tm_wday not in days:
        return False
    if hours and now.tm_hour not in hours:
        return False
    return True


def cooldown_ok(last_epoch: float | None, now_epoch: float, cooldown_hours: float) -> bool:
    if last_epoch is None:
        return True
    return (now_epoch - last_epoch) >= cooldown_hours * 3600.0


# ── Health check + resize orchestration (side-effecting) ───────────────────────
def health_ok(hc: dict) -> bool:
    url = (hc or {}).get("url")
    if not url:
        return True  # no health check configured => treat as pass (documented)
    expect = int(hc.get("expect_status", 200))
    deadline = time.time() + int(hc.get("timeout_s", 300))
    last = None
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "grove-auto-resize/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                last = resp.status
                if last == expect:
                    return True
        except urllib.error.HTTPError as e:
            last = e.code
            if last == expect:
                return True
        except (urllib.error.URLError, TimeoutError, OSError):
            last = None
        time.sleep(10)
    print(f"  health check {url} never returned {expect} (last={last})", file=sys.stderr)
    return False


def perform_resize(droplet_id: str, target_slug: str, token: str) -> None:
    """Power-off -> resize(disk=false) -> power-on -> wait active. Raises on failure."""
    if droplet_status(droplet_id, token) == "active":
        aid = droplet_action(droplet_id, {"type": "power_off"}, token)
        if wait_action(droplet_id, aid, token) != "completed":
            raise RuntimeError("power_off did not complete")
    # disk=false is the whole point: CPU/RAM-only, reversible, never grows disk.
    aid = droplet_action(droplet_id, {"type": "resize", "size": target_slug, "disk": False}, token)
    if wait_action(droplet_id, aid, token) != "completed":
        raise RuntimeError(f"resize to {target_slug} did not complete")
    aid = droplet_action(droplet_id, {"type": "power_on"}, token)
    if wait_action(droplet_id, aid, token) != "completed":
        raise RuntimeError("power_on did not complete")


def execute_one(d: dict, target_slug: str, prev_slug: str, cfg: dict,
                token: str, webhook: str) -> str:
    """Run the guarded resize with health-gate + rollback. Returns a status line."""
    name = d["name"]
    droplet_id = str(d["id"])
    perform_resize(droplet_id, target_slug, token)
    if health_ok(cfg.get("health_check", {})):
        return f"✅ `{name}` resized {prev_slug} -> {target_slug} (disk-preserving); health OK"
    # Rollback: power-cycle back to the previous slug.
    print(f"  {name}: health gate FAILED after {target_slug} — rolling back to {prev_slug}",
          file=sys.stderr)
    _announce(webhook, f"⚠️ `{name}` health gate failed on {target_slug} — rolling back to {prev_slug}")
    perform_resize(droplet_id, prev_slug, token)  # raises => run fails (page-worthy)
    healed = health_ok(cfg.get("health_check", {}))
    tail = "health OK after rollback" if healed else "⛔ STILL UNHEALTHY after rollback — investigate"
    return f"🔁 `{name}` ROLLED BACK {target_slug} -> {prev_slug} ({tail})"


def _announce(webhook: str, content: str) -> None:
    print(content)
    if not webhook:
        return
    try:
        post_discord(webhook, content)
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
        print(f"  (Discord announce failed: {e})", file=sys.stderr)


# ── Main ───────────────────────────────────────────────────────────────────────
def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def process_droplet(cfg: dict, by_name: dict, token: str, webhook: str,
                    armed: bool, now_epoch: float, window_days_default: float) -> str:
    name = cfg.get("name", "?")
    d = by_name.get(name)
    if not d:
        return f"⚪ `{name}` — not found in this DO account (renamed? wrong token scope?)"
    slug = d.get("size_slug", "?")
    droplet_id = str(d["id"])
    window_days = float(cfg.get("window_days", window_days_default))
    end = int(now_epoch)
    start = end - int(window_days * 86400)

    cpu = cpu_p50_p95(droplet_id, start, end, token)
    mem = mem_p50_p95(droplet_id, start, end, token)
    action, driver = decide(cpu, mem, cfg)

    def stat(pair: tuple[float, float] | None) -> str:
        return f"p95 {pair[1]:.0f}%/p50 {pair[0]:.0f}%" if pair else "n/a"
    stats = f"cpu {stat(cpu)} mem {stat(mem)} over {window_days:.0f}d"

    if action in ("hold", "nodata"):
        icon = "🟢" if action == "hold" else "⚪"
        return f"{icon} `{name}` ({slug}) — {action} ({stats})"

    target = bounded_target(slug, action, cfg)
    if target is None:
        return f"🟡 `{name}` ({slug}) — {action} wanted ({driver}) but at band edge ({stats})"

    # ── gates ──
    if not within_window(time.gmtime(now_epoch), cfg.get("maintenance_window", {})):
        return f"🕒 `{name}` {action} {slug}->{target} deferred — outside maintenance window ({stats})"
    last = last_resize_epoch(droplet_id, token)
    if not cooldown_ok(last, now_epoch, float(cfg.get("cooldown_hours", 72))):
        return f"❄️ `{name}` {action} {slug}->{target} deferred — in cooldown ({stats})"

    per_enabled = bool(cfg.get("enabled", False))
    will_mutate = armed and per_enabled
    verb = "WILL resize" if will_mutate else "would resize (dry-run)"
    gate = "" if will_mutate else (
        "  [dry-run: AUTO_RESIZE_ENABLED unset]" if not armed
        else "  [dry-run: droplet enabled:false in manifest]")
    plan = f"🔧 `{name}` {driver} {action}: {verb} {slug}->{target} (disk-preserving){gate} ({stats})"
    _announce(webhook, plan)

    if not will_mutate:
        return plan
    return execute_one(d, target, slug, cfg, token, webhook)


def main() -> int:
    if "--self-test" in sys.argv:
        return _self_test()

    token = (os.environ.get("AUTO_RESIZE_DO_TOKEN", "").strip()
             or os.environ.get("DO_MONITORING_TOKEN", "").strip())
    if not token:
        print("ERROR: no DO token (AUTO_RESIZE_DO_TOKEN or DO_MONITORING_TOKEN)", file=sys.stderr)
        return 2
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    forced_dry = os.environ.get("DRY_RUN", "") == "1"
    armed = (os.environ.get("AUTO_RESIZE_ENABLED", "") == "1") and not forced_dry
    config_path = os.environ.get("AUTO_RESIZE_CONFIG", "").strip() or CONFIG_DEFAULT

    try:
        cfg_doc = load_config(config_path)
    except (OSError, ValueError) as e:
        print(f"ERROR: cannot read config {config_path}: {e}", file=sys.stderr)
        return 2

    now_epoch = time.time()
    try:
        droplets = list_droplets(token)
    except urllib.error.HTTPError as e:
        print(f"ERROR: DO droplets list failed: {e.code} {e.reason}", file=sys.stderr)
        return 2
    by_name = {d["name"]: d for d in droplets}

    lines = []
    for cfg in cfg_doc.get("droplets", []):
        try:
            lines.append(process_droplet(cfg, by_name, token, webhook, armed, now_epoch, 3))
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
            # A per-droplet operational failure (incl. failed rollback) is a real signal.
            msg = f"⛔ `{cfg.get('name','?')}` auto-resize errored: {e}"
            _announce(webhook, msg)
            lines.append(msg)
            print(f"ERROR during {cfg.get('name','?')}: {e}", file=sys.stderr)
            return 2

    mode = "ARMED" if armed else "dry-run"
    header = f"**⚙️ Auto-resize executor** ({mode}) — Tier 2B, disk-preserving only\n"
    print(header + "\n".join(lines))
    return 0


def _self_test() -> int:
    """No-network checks of the pure decision/gate logic (runs in CI)."""
    cfg = {"bump_pct": 85, "downsize_mem_pct": 30, "downsize_cpu_pct": 20,
           "min_slug": "s-1vcpu-2gb", "max_slug": "s-2vcpu-4gb"}
    assert decide((10, 90), (10, 20), cfg) == ("bump", "cpu")
    assert decide((10, 20), (10, 90), cfg) == ("bump", "mem")
    assert decide((5, 10), (5, 15), cfg) == ("downsize", "idle")
    assert decide((10, 50), (10, 50), cfg) == ("hold", "")  # hysteresis band
    assert decide(None, None, cfg) == ("nodata", "")
    # band clamps
    assert bounded_target("s-2vcpu-4gb", "bump", cfg) is None      # at max
    assert bounded_target("s-1vcpu-2gb", "downsize", cfg) is None  # at min
    assert bounded_target("s-1vcpu-2gb", "bump", cfg) == "s-2vcpu-2gb"
    assert bounded_target("s-2vcpu-2gb", "downsize", cfg) == "s-1vcpu-2gb"
    # window
    win = {"utc_days": [2], "utc_hours": [8, 9]}
    assert within_window(time.strptime("2026-07-15 08:00", "%Y-%m-%d %H:%M"), win)   # Wed=2
    assert not within_window(time.strptime("2026-07-15 10:00", "%Y-%m-%d %H:%M"), win)
    assert not within_window(time.strptime("2026-07-16 08:00", "%Y-%m-%d %H:%M"), win)  # Thu=3
    assert within_window(time.strptime("2026-07-16 08:00", "%Y-%m-%d %H:%M"), {})  # empty=always
    # cooldown
    now = 1_000_000.0
    assert cooldown_ok(None, now, 72)
    assert not cooldown_ok(now - 3600, now, 72)
    assert cooldown_ok(now - 73 * 3600, now, 72)
    print("auto-resize self-test: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
