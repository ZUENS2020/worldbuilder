#!/usr/bin/env bash
# One-time server setup: init git repo + install cron auto-deploy.
# Usage (on server):
#   curl -fsSL https://raw.githubusercontent.com/ZUENS2020/worldbuilder/main/scripts/setup-auto-deploy.sh | bash
# Or after first manual clone:
#   bash ~/worldbuilder/scripts/setup-auto-deploy.sh

set -euo pipefail

REPO_DIR="${WORLDBUILDER_DIR:-$HOME/worldbuilder}"
REPO_URL="${WORLDBUILDER_REPO:-https://github.com/ZUENS2020/worldbuilder.git}"
BRANCH="${WORLDBUILDER_BRANCH:-main}"
CRON_INTERVAL="${WORLDBUILDER_CRON:-*/5}"   # every 5 minutes

mkdir -p "$REPO_DIR/logs" "$REPO_DIR/data"

cd "$REPO_DIR"

# ── Init git if this directory was deployed via rsync ──
if [[ ! -d .git ]]; then
  echo "[setup] initializing git in $REPO_DIR …"
  # Preserve .env and data/ (untracked after init)
  git init -q
  git remote add origin "$REPO_URL"
  git fetch origin "$BRANCH" --depth=1
  git checkout -B "$BRANCH" "origin/$BRANCH"
else
  echo "[setup] git repo already present"
  git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"
fi

chmod +x "$REPO_DIR/scripts/deploy.sh"

# ── Install cron job (idempotent) ──
CRON_LINE="$CRON_INTERVAL * * * * $REPO_DIR/scripts/deploy.sh >> $REPO_DIR/logs/deploy.log 2>&1"
MARKER="# worldbuilder-auto-deploy"

if crontab -l 2>/dev/null | grep -qF "$MARKER"; then
  crontab -l 2>/dev/null | grep -vF "$MARKER" | grep -vF "$REPO_DIR/scripts/deploy.sh" | { cat; echo "$CRON_LINE $MARKER"; } | crontab -
else
  (crontab -l 2>/dev/null; echo "$CRON_LINE $MARKER") | crontab -
fi

echo "[setup] cron installed: $CRON_INTERVAL * * * *"
echo "[setup] log: $REPO_DIR/logs/deploy.log"
echo "[setup] running first deploy …"
"$REPO_DIR/scripts/deploy.sh"

echo "[setup] done."
