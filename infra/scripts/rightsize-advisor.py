#!/usr/bin/env python3
"""Stateful-droplet rightsize advisor — advisory only, ZERO mutation (GOL-253).

Reads each stateful droplet's 7-day p95 CPU + memory utilisation from the
DigitalOcean monitoring API and posts a right-size recommendation to the Discord
ops webhook. This is the "observability before optimization" step of GOL-241
Tier 2A: it *recommends* a size, it never resizes anything.

Why a read-only advisor and not an auto-resize: DO cannot autoscale a stateful
single droplet — a vertical resize is a reboot (downtime) and a disk grow is
one-way (can't shrink). So the correct first move, regardless of the D1/D2 board
decisions, is to surface accurate p95-based recommendations to a human. Fixed
right-size follow-through folds into GOL-51; guarded opt-in auto-resize is the
separate GOL-254.

Credentials (both injected by CI, never held by any agent):
  DO_MONITORING_TOKEN   read-only DO token (monitoring:read + droplet:read)
  DISCORD_WEBHOOK_URL   Grove ops webhook

Env knobs (all optional):
  RIGHTSIZE_TARGETS     comma-separated droplet names to advise on
                        (default: "agenticos-droplet")
  WINDOW_DAYS           lookback window in days (default: 7)
  BUMP_PCT              p95 >= this % on CPU or mem -> recommend a bump up
                        (default: 85)
  DOWNSIZE_MEM_PCT      p95 mem below this AND cpu below DOWNSIZE_CPU_PCT ->
                        downsize candidate (default: 30)
  DOWNSIZE_CPU_PCT      (default: 20)
  DRY_RUN               if "1", print the payload and skip the Discord POST

Exit status is 0 on a successful advisory run (including "everything
right-sized"); non-zero only on an operational failure (bad token, API error),
so a scheduled failure is a real signal.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

DO_API = "https://api.digitalocean.com/v2"

# Memory-tier ladder for the standard slugs this fleet uses. The advisor suggests
# the adjacent tier as a *hint*; a real resize (GOL-51/GOL-254) picks the slug.
# Ordered small -> large by memory.
SIZE_LADDER = [
    "s-1vcpu-1gb",
    "s-1vcpu-2gb",
    "s-2vcpu-2gb",
    "s-2vcpu-4gb",
    "s-4vcpu-8gb",
    "s-8vcpu-16gb",
]


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def do_get(path: str, token: str) -> dict:
    req = urllib.request.Request(
        f"{DO_API}{path}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def list_droplets(token: str) -> list[dict]:
    droplets, page = [], 1
    while True:
        data = do_get(f"/droplets?per_page=200&page={page}", token)
        batch = data.get("droplets", [])
        droplets.extend(batch)
        nxt = (data.get("links", {}) or {}).get("pages", {}) or {}
        if not nxt.get("next"):
            break
        page += 1
    return droplets


def _metric_series(metric: str, host_id: str, start: int, end: int, token: str) -> list[dict]:
    path = f"/monitoring/metrics/droplet/{metric}?host_id={host_id}&start={start}&end={end}"
    return do_get(path, token).get("data", {}).get("result", []) or []


def percentile(values: list[float], pct: float) -> float | None:
    """Nearest-rank percentile (pct in 0..100)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, int(round(pct / 100.0 * len(ordered))))
    return ordered[min(rank, len(ordered)) - 1]


def _p50_p95(values: list[float]) -> tuple[float, float] | None:
    p95 = percentile(values, 95)
    p50 = percentile(values, 50)
    if p95 is None or p50 is None:
        return None
    return p50, p95


def mem_p50_p95(host_id: str, start: int, end: int, token: str) -> tuple[float, float] | None:
    """7-day (p50, p95) memory *used* %, from memory_total - memory_available."""
    total = _metric_series("memory_total", host_id, start, end, token)
    avail = _metric_series("memory_available", host_id, start, end, token)
    if not total or not avail:
        return None
    total_by_ts = {int(t): float(v) for t, v in total[0].get("values", []) if float(v) > 0}
    used_pct = []
    for t, v in avail[0].get("values", []):
        ts = int(t)
        tot = total_by_ts.get(ts)
        if tot:
            used_pct.append((tot - float(v)) / tot * 100.0)
    return _p50_p95(used_pct)


def cpu_p50_p95(host_id: str, start: int, end: int, token: str) -> tuple[float, float] | None:
    """7-day (p50, p95) CPU busy %, from the cumulative per-mode CPU counters.

    DO returns cumulative CPU-time counters per mode (idle, user, system, ...).
    Utilisation over each sample interval = 1 - (idle delta / total delta),
    where iowait counts as busy (conservative for right-sizing). p50/p95 across
    all intervals — p95 drives the recommendation, p50 shows sustained vs bursty.
    """
    result = _metric_series("cpu", host_id, start, end, token)
    if not result:
        return None
    # mode -> {ts: cumulative_value}
    modes: dict[str, dict[int, float]] = {}
    timestamps: set[int] = set()
    for series in result:
        mode = series.get("metric", {}).get("mode")
        if not mode:
            continue
        pts = {int(t): float(v) for t, v in series.get("values", [])}
        modes[mode] = pts
        timestamps.update(pts.keys())
    if "idle" not in modes or len(timestamps) < 2:
        return None
    ordered_ts = sorted(timestamps)
    busy_pct = []
    for prev, cur in zip(ordered_ts, ordered_ts[1:]):
        total_delta = 0.0
        idle_delta = 0.0
        ok = True
        for mode, pts in modes.items():
            if prev not in pts or cur not in pts:
                ok = False
                break
            d = pts[cur] - pts[prev]
            if d < 0:  # counter reset / reboot — skip this interval
                ok = False
                break
            total_delta += d
            if mode == "idle":
                idle_delta = d
        if ok and total_delta > 0:
            busy_pct.append((1.0 - idle_delta / total_delta) * 100.0)
    return _p50_p95(busy_pct)


def adjacent_slug(slug: str, direction: int) -> str | None:
    if slug not in SIZE_LADDER:
        return None
    i = SIZE_LADDER.index(slug) + direction
    return SIZE_LADDER[i] if 0 <= i < len(SIZE_LADDER) else None


def recommend(name: str, slug: str,
              cpu: tuple[float, float] | None, mem: tuple[float, float] | None,
              bump_pct: float, down_mem: float, down_cpu: float) -> tuple[str, str]:
    """Return (severity, human line). severity in {bump, downsize, ok, nodata}.

    cpu/mem are (p50, p95) tuples or None. p95 drives the recommendation; p50 is
    surfaced so a spiky-but-idle box (high p95, low p50) reads differently from a
    sustained-hot one.
    """
    cpu95 = cpu[1] if cpu else None
    mem95 = mem[1] if mem else None

    def fmt(pair):
        return f"p95 {pair[1]:.0f}% (p50 {pair[0]:.0f}%)" if pair else "n/a"

    stats = f"cpu {fmt(cpu)} / mem {fmt(mem)} over 7d"

    if cpu is None and mem is None:
        return "nodata", f"⚪ `{name}` ({slug}) — no monitoring data (agent installed? metrics enabled?)"

    hot_mem = mem95 is not None and mem95 >= bump_pct
    hot_cpu = cpu95 is not None and cpu95 >= bump_pct
    if hot_mem or hot_cpu:
        driver, dpair = ("mem", mem) if hot_mem else ("cpu", cpu)
        up = adjacent_slug(slug, +1)
        target = f" -> bump {slug} -> {up}" if up else " -> bump to next larger size"
        burst = "" if dpair[0] >= bump_pct * 0.6 else " [bursty: p50 low, verify sustained load before resizing]"
        return "bump", f"🔴 `{name}` {driver} p95 {dpair[1]:.0f}% for 7d ({stats}){target}{burst}"

    cold = (mem95 is not None and mem95 < down_mem) and (cpu95 is not None and cpu95 < down_cpu)
    if cold:
        down = adjacent_slug(slug, -1)
        target = f" -> downsize candidate {slug} -> {down}" if down else " -> downsize candidate"
        return "downsize", f"🟡 `{name}` idle ({stats}){target}"

    return "ok", f"🟢 `{name}` ({slug}) right-sized ({stats})"


def post_discord(webhook: str, content: str) -> None:
    payload = json.dumps({"content": content}).encode()
    req = urllib.request.Request(
        webhook,
        data=payload,
        # Discord 403s the default "Python-urllib/x.y" User-Agent, so set a real one.
        headers={"Content-Type": "application/json", "User-Agent": "grove-rightsize-advisor/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status not in (200, 204):
            raise RuntimeError(f"Discord POST returned {resp.status}")


def main() -> int:
    token = os.environ.get("DO_MONITORING_TOKEN", "").strip()
    if not token:
        print("ERROR: DO_MONITORING_TOKEN is not set", file=sys.stderr)
        return 2
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    dry_run = os.environ.get("DRY_RUN", "") == "1"

    # NB: CI sets RIGHTSIZE_TARGETS="" on schedule/repository_dispatch (the
    # workflow_dispatch input is absent), so an empty/whitespace value must fall
    # back to the default rather than resolving to "no targets".
    targets_raw = os.environ.get("RIGHTSIZE_TARGETS", "").strip() or "agenticos-droplet"
    targets = [t.strip() for t in targets_raw.split(",") if t.strip()]
    window_days = _env_float("WINDOW_DAYS", 7)
    bump_pct = _env_float("BUMP_PCT", 85)
    down_mem = _env_float("DOWNSIZE_MEM_PCT", 30)
    down_cpu = _env_float("DOWNSIZE_CPU_PCT", 20)

    end = int(time.time())
    start = end - int(window_days * 86400)

    try:
        droplets = list_droplets(token)
    except urllib.error.HTTPError as e:
        print(f"ERROR: DO droplets list failed: {e.code} {e.reason}", file=sys.stderr)
        return 2
    by_name = {d["name"]: d for d in droplets}

    lines = []
    for name in targets:
        d = by_name.get(name)
        if not d:
            lines.append((f"⚪ `{name}` — not found in this DO account (renamed? wrong token scope?)", "nodata"))
            continue
        host_id = str(d["id"])
        slug = d.get("size_slug", "?")
        try:
            cpu = cpu_p50_p95(host_id, start, end, token)
            mem = mem_p50_p95(host_id, start, end, token)
        except urllib.error.HTTPError as e:
            print(f"ERROR: metrics for {name} failed: {e.code} {e.reason}", file=sys.stderr)
            return 2
        sev, line = recommend(name, slug, cpu, mem, bump_pct, down_mem, down_cpu)
        lines.append((line, sev))

    body = "\n".join(l for l, _ in lines)
    header = f"**📐 Droplet right-size advisor** — 7d p95, advisory only (no resize performed)\n"
    content = header + body

    print(content)

    if dry_run:
        print("\n[DRY_RUN] skipping Discord POST", file=sys.stderr)
        return 0
    if not webhook:
        print("ERROR: DISCORD_WEBHOOK_URL is not set (and DRY_RUN != 1)", file=sys.stderr)
        return 2
    try:
        post_discord(webhook, content)
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as e:
        print(f"ERROR: Discord POST failed: {e}", file=sys.stderr)
        return 2
    print("\nPosted advisory to Discord ops webhook.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
