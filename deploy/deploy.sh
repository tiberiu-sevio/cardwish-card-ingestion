#!/usr/bin/env bash
# Deploy the card-ingestion service from this machine to the droplet.
# Usage: deploy/deploy.sh [user@host]
set -euo pipefail

HOST="${1:-root@161.35.223.39}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/cardwish-catawiki}"
APP_DIR=/opt/cardwish-card-ingestion
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> rsync code to $HOST:$APP_DIR"
rsync -az --delete \
  -e "ssh -i $SSH_KEY" \
  --exclude node_modules --exclude .git --exclude .idea --exclude .env \
  "$REPO_DIR/" "$HOST:$APP_DIR/"

echo "==> install deps + prisma generate"
# Piped over stdin as a literal heredoc — see cardwish-crawler's deploy.sh for
# why (quoted ssh arguments silently mangled the script once already).
ssh -T -i "$SSH_KEY" "$HOST" APP_DIR="$APP_DIR" bash <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"
npm ci --no-audit --no-fund
npx prisma generate
chown -R cardwish:cardwish "$APP_DIR"
# Batch service (oneshot + timer): nothing to restart. A running sync keeps
# its old code until it finishes; the next timer run picks up this deploy.
systemctl list-timers --no-pager | grep -E 'cardwish-card-sync|NEXT' || true
REMOTE
echo "==> deployed"
