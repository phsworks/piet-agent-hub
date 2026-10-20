#!/bin/bash
# One-time setup of a fresh Ubuntu VPS (Hetzner CX22) for Piet's Brain:
# Docker, Tailscale (with SSH and HTTPS), firewall, swap.
#   bash scripts/vps-setup.sh root@<public ip>    first run
#   bash scripts/vps-setup.sh lock                 afterwards: close public SSH (Tailscale only)
set -euo pipefail
VPS="${VPS:-root@piet-brain.tail4b403a.ts.net}"

if [ "${1:-}" = "lock" ]; then
  # Only once `ssh root@piet-brain` works over Tailscale.
  ssh "$VPS" 'ufw delete allow 22/tcp && ufw status'
  echo "Public SSH closed; the VPS is only reachable over Tailscale now."
  exit 0
fi

TARGET="${1:?usage: vps-setup.sh root@<public ip>}"
ssh -t "$TARGET" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q && apt-get upgrade -yq
apt-get install -yq ufw unattended-upgrades rsync

# Docker (official script, includes the compose plugin).
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

# The Next.js build needs more memory than 4 GB on a bad day.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Firewall: nothing in from the internet except SSH (closed later with `lock`).
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow 22/tcp
ufw --force enable

# Tailscale: prints a login link the first time; open it to add the VPS to your tailnet.
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --hostname=piet-brain
# HTTPS on https://piet-brain.<tailnet>.ts.net → the app (needs HTTPS enabled in the Tailscale admin, DNS page).
tailscale serve --bg 3210

mkdir -p /opt/piet-brain
echo
echo "Done. Tailscale URL: https://$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
REMOTE
