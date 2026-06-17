#!/usr/bin/env bash
# Pull latest from GitHub and rebuild Docker containers.
# Run on the server: ~/worldbuilder/scripts/deploy.sh
# Cron (every 5 min): see setup-auto-deploy.sh

set -euo pipefail

REPO_DIR="${WORLDBUILDER_DIR:-$HOME/worldbuilder}"
BRANCH="${WORLDBUILDER_BRANCH:-main}"
REMOTE="${WORLDBUILDER_REMOTE:-origin}"
LOG_DIR="$REPO_DIR/logs"

cd "$REPO_DIR"
mkdir -p "$LOG_DIR" data

if [[ ! -d .git ]]; then
  echo "[deploy] ERROR: $REPO_DIR is not a git repo. Run setup-auto-deploy.sh first." >&2
  exit 1
fi

echo "[deploy] $(date -Is) checking $REMOTE/$BRANCH …"

git fetch "$REMOTE" "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$LOCAL" == "$REMOTE_SHA" ]]; then
  echo "[deploy] already up to date ($LOCAL)"
  exit 0
fi

echo "[deploy] updating $LOCAL → $REMOTE_SHA"
git pull --ff-only "$REMOTE" "$BRANCH"

echo "[deploy] rebuilding containers …"
docker compose build
docker compose up -d

echo "[deploy] done at $(git rev-parse --short HEAD)"
