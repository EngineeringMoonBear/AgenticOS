#!/usr/bin/env python3
"""GOL-657 — one-shot, safe DigitalOcean Droplet resize (the GOL-51 execution
follow-through to the GOL-253 rightsize *advisor*).

WHY THIS RUNS IN CI, NOT `terraform apply`
------------------------------------------
A Droplet resize requires DigitalOcean to power the Droplet OFF, resize, then
power it back ON. `agenticos-droplet` is the ONE production box — it runs
Paperclip, every agent, and the Postgres/OpenViking volumes. A `terraform apply`
(or any resize) launched FROM that Droplet would be killed the instant DO powers
it off: Terraform would issue the power-off action and then die before it could
issue the resize + power-on, leaving the box stranded OFF (a full outage). So the
resize must be driven from an EXTERNAL runner (GitHub Actions) that survives the
reboot. This script is that driver. `infra/terraform/variables.tf` is bumped to
the same target so `terraform plan` shows zero drift afterward (state refresh
reads the new size_slug back).

SAFETY
------
* Idempotent: if the Droplet is already at TARGET_SIZE, it is a clean no-op.
* Never-leave-it-off: once powered off, ANY subsequent failure triggers a
  best-effort power_on before exiting non-zero, and shouts to Discord.
* Reversible by default: RESIZE_DISK=false keeps the existing disk (CPU/RAM-only
  resize), so the box can be scaled back down later. Set RESIZE_DISK=true only
  for a permanent, IRREVERSIBLE disk grow.
* DRY_RUN prints the plan and exits without mutating anything.

ENV
---
  DO_TOKEN             DigitalOcean token with droplet:write (scoped PAT). Required.
  DROPLET_NAME         default "agenticos-droplet"
  TARGET_SIZE          default "s-4vcpu-8gb"
  RESIZE_DISK          "true"/"false", default "false" (reversible)
  DISCORD_WEBHOOK_URL  optional Grove ops webhook for start/finish notices
  DRY_RUN              "1" to compute + print only
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.digitalocean.com/v2"
TOKEN = os.environ.get("DO_TOKEN", "").strip()
DROPLET_NAME = os.environ.get("DROPLET_NAME", "agenticos-droplet").strip()
TARGET_SIZE = os.environ.get("TARGET_SIZE", "s-4vcpu-8gb").strip()
RESIZE_DISK = os.environ.get("RESIZE_DISK", "false").strip().lower() in ("1", "true", "yes")
DISCORD = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
DRY_RUN = os.environ.get("DRY_RUN", "").strip() in ("1", "true", "yes")


def log(msg):
    print(f"[resize-droplet] {msg}", flush=True)


def discord(msg):
    """Best-effort ops notification; never fatal."""
    if not DISCORD:
        return
    try:
        body = json.dumps({"content": msg[:1900]}).encode()
        req = urllib.request.Request(DISCORD, data=body, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # noqa: BLE001
        log(f"discord notify failed (non-fatal): {e}")


def api(method, path, payload=None):
    url = f"{API}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw)
        except Exception:  # noqa: BLE001
            parsed = {"raw": raw.decode("utf-8", "replace")}
        return e.code, parsed


def find_droplet():
    status, body = api("GET", f"/droplets?name={urllib.parse.quote(DROPLET_NAME)}&per_page=200")
    if status != 200:
        die(f"list droplets failed: HTTP {status} {body}")
    matches = [d for d in body.get("droplets", []) if d.get("name") == DROPLET_NAME]
    if not matches:
        die(f"no Droplet named {DROPLET_NAME!r} found")
    if len(matches) > 1:
        die(f"{len(matches)} Droplets named {DROPLET_NAME!r} — refusing to guess")
    return matches[0]


def get_droplet(did):
    status, body = api("GET", f"/droplets/{did}")
    if status != 200:
        die(f"get droplet {did} failed: HTTP {status} {body}")
    return body["droplet"]


def do_action(did, payload, label):
    status, body = api("POST", f"/droplets/{did}/actions", payload)
    if status not in (201, 200):
        raise RuntimeError(f"{label} action rejected: HTTP {status} {body}")
    action = body["action"]
    log(f"{label}: action {action['id']} status={action['status']}")
    return action["id"]


def wait_action(did, action_id, label, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, body = api("GET", f"/droplets/{did}/actions/{action_id}")
        if status == 200:
            st = body["action"]["status"]
            if st == "completed":
                log(f"{label}: action {action_id} completed")
                return
            if st == "errored":
                raise RuntimeError(f"{label}: action {action_id} ERRORED")
        time.sleep(8)
    raise RuntimeError(f"{label}: action {action_id} did not complete within {timeout}s")


def wait_status(did, want, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        d = get_droplet(did)
        if d.get("status") == want:
            log(f"droplet status is {want!r}")
            return d
        time.sleep(8)
    raise RuntimeError(f"droplet did not reach status {want!r} within {timeout}s")


def die(msg):
    log(f"FATAL: {msg}")
    discord(f":rotating_light: **Droplet resize FAILED** ({DROPLET_NAME}): {msg}")
    sys.exit(1)


def main():
    if not TOKEN:
        die("DO_TOKEN is empty — cannot authenticate to DigitalOcean")

    d = find_droplet()
    did = d["id"]
    cur = d.get("size_slug")
    log(f"Droplet {DROPLET_NAME} id={did} current size={cur} status={d.get('status')}")
    log(f"Target size={TARGET_SIZE} resize_disk={RESIZE_DISK} dry_run={DRY_RUN}")

    if cur == TARGET_SIZE:
        log("already at target size — nothing to do (idempotent no-op)")
        discord(f":white_check_mark: {DROPLET_NAME} already at `{TARGET_SIZE}` — resize is a no-op.")
        return

    if DRY_RUN:
        log(f"DRY_RUN: would resize {cur} -> {TARGET_SIZE} (disk={RESIZE_DISK}). No changes made.")
        return

    discord(
        f":arrows_counterclockwise: **Resizing {DROPLET_NAME}** `{cur}` -> `{TARGET_SIZE}` "
        f"(disk={'grow' if RESIZE_DISK else 'keep'}). ~1-2 min of downtime; the box (and Paperclip) "
        f"will reboot. GOL-657."
    )

    powered_off = False
    try:
        # 1) power off (a resize requires the Droplet be off)
        aid = do_action(did, {"type": "power_off"}, "power_off")
        wait_action(did, aid, "power_off", 180)
        wait_status(did, "off", 120)
        powered_off = True

        # 2) resize
        aid = do_action(did, {"type": "resize", "size": TARGET_SIZE, "disk": RESIZE_DISK}, "resize")
        wait_action(did, aid, "resize", 900)

        # 3) power back on
        aid = do_action(did, {"type": "power_on"}, "power_on")
        wait_action(did, aid, "power_on", 180)
        d = wait_status(did, "active", 180)
        powered_off = False

        final = d.get("size_slug")
        if final != TARGET_SIZE:
            die(f"resize reported complete but size_slug={final!r} != {TARGET_SIZE!r}")

        log(f"SUCCESS: {DROPLET_NAME} is {final} and active")
        discord(
            f":white_check_mark: **{DROPLET_NAME} resized** `{cur}` -> `{final}` and back online (status=active). "
            f"OOM headroom restored (GOL-657). Terraform `droplet_size` already tracks this, so `plan` stays clean."
        )
    except Exception as e:  # noqa: BLE001
        # Never leave the box off. Best-effort power_on before we bail.
        log(f"ERROR during resize: {e}")
        if powered_off:
            log("attempting emergency power_on so the Droplet is not left OFF...")
            try:
                aid = do_action(did, {"type": "power_on"}, "emergency_power_on")
                wait_action(did, aid, "emergency_power_on", 180)
                wait_status(did, "active", 180)
                log("emergency power_on succeeded — box is back up (resize may be incomplete)")
                discord(
                    f":warning: **{DROPLET_NAME} resize FAILED but box was powered back ON** — {e}. "
                    f"Current size may still be `{cur}`. Needs a human look (GOL-657)."
                )
            except Exception as e2:  # noqa: BLE001
                discord(
                    f":rotating_light: **{DROPLET_NAME} resize FAILED AND could not power back on** — {e} / {e2}. "
                    f"THE BOX MAY BE OFF — power it on in the DO console NOW (GOL-657)."
                )
                die(f"resize failed AND emergency power_on failed: {e} / {e2}")
        die(f"resize failed: {e}")


if __name__ == "__main__":
    main()
