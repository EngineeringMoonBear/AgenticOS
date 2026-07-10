#!/bin/sh
# GOL-238: ensure the 4G swap safety-net on the AgenticOS host.
#
# Why this exists: the swap file is defined in cloud-init, but cloud-init only
# runs on droplet build. Droplet 572389418 predates that snippet, so /swapfile
# was never created and the OOM-killer fired at 91.8% RAM (2026-07-10 11:16Z),
# killing a UI-backing container. Container mem_limits sum to ~7.4G on a 4G box,
# so swap is load-bearing.
#
# How it runs: the deploy user is non-root with no passwordless sudo, but is in
# the docker group (== host root). deploy-droplet.yml runs this inside a
# privileged one-shot container that bind-mounts the host root at $HOST. swapon
# and sysctl are GLOBAL kernel operations, so enabling swap here takes effect
# host-wide (all processes + containers share the one kernel swap pool). File
# writes go under $HOST for host persistence across reboots.
#
# Idempotent: safe to run on every deploy.
set -e
HOST="${HOST:-/host}"
SWAP="$HOST/swapfile"

if [ ! -f "$SWAP" ]; then
  # fallocate can leave holes on some fs; dd fallback guarantees a dense file.
  fallocate -l 4G "$SWAP" 2>/dev/null || dd if=/dev/zero of="$SWAP" bs=1M count=4096
  chmod 600 "$SWAP"
  mkswap "$SWAP"
fi

# swapon registers the file's blocks in the shared kernel swap pool; the path it
# is referenced by here vs. /swapfile at boot does not matter to the kernel.
swapon "$SWAP" 2>/dev/null || true

# Persist across reboots (fstab uses the host-native /swapfile path).
grep -q '^/swapfile' "$HOST/etc/fstab" || echo '/swapfile none swap sw 0 0' >> "$HOST/etc/fstab"
echo 'vm.swappiness=10' > "$HOST/etc/sysctl.d/99-swap.conf"
sysctl -w vm.swappiness=10 2>/dev/null || true

echo '--- active swap (/proc/swaps) ---'
cat /proc/swaps
