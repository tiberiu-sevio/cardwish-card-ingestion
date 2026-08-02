#!/usr/bin/env bash
# Idempotent provisioning for the card-ingestion droplet (Ubuntu 24.04).
# Installs Node 24, creates the app user and installs the daily sync timer.
# No queues, no long-running worker — this service is a daily batch job.
# Run as root from $APP_DIR/deploy. Safe to re-run.
set -euo pipefail

APP_DIR=/opt/cardwish-card-ingestion

echo "==> swap (2G, for npm installs on small droplets)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git rsync ca-certificates

echo "==> node 24 (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
node -v

echo "==> app user + directory"
id cardwish &>/dev/null || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin cardwish
mkdir -p "$APP_DIR"
chown cardwish:cardwish "$APP_DIR"

echo "==> systemd units"
cp "$APP_DIR/deploy/cardwish-card-sync.service" /etc/systemd/system/
cp "$APP_DIR/deploy/cardwish-card-sync.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cardwish-card-sync.timer

echo "==> done. Next: create $APP_DIR/.env, deploy code (deploy/deploy.sh), then: systemctl start cardwish-card-sync"
