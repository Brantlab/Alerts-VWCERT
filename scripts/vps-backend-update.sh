#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Alerts-VWCERT}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
SPARSE_PATHS=(backend calendar docker-compose.yml .env.example README.md .gitignore)

if ! command -v git >/dev/null 2>&1; then
  echo "git is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "First run needs REPO_URL, for example:" >&2
    echo "  REPO_URL=https://github.com/OWNER/REPO.git $0" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --filter=blob:none --sparse --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

git sparse-checkout init --cone
git sparse-checkout set "${SPARSE_PATHS[@]}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created $APP_DIR/.env from .env.example. Edit it before exposing writes publicly."
fi

docker compose up -d --build "$BACKEND_SERVICE"

echo "Backend health check:"
if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:${BACKEND_PORT:-8080}/health"
  echo
else
  docker compose ps "$BACKEND_SERVICE"
fi

docker image prune -f
docker builder prune -f

echo "Done. Docker disk usage:"
docker system df
