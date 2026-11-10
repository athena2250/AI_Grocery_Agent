#!/usr/bin/env bash
# Local sandbox: bash scripts/dev.sh
# Shared API + admin + browser: bash scripts/dev.sh full
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-sandbox}"
if [[ "$MODE" != sandbox && "$MODE" != full ]]; then
  echo "Usage: bash scripts/dev.sh [sandbox|full]" >&2
  exit 1
fi
if [[ ! -d "$ROOT/mobile/node_modules" ]]; then
  echo "Install mobile dependencies first: cd mobile && npm ci" >&2
  exit 1
fi
if [[ "$MODE" == sandbox ]]; then
  cd "$ROOT/mobile"
  EXPO_PUBLIC_API_URL= exec npm run web -- --port 8081
fi
PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo 'Set up the backend first (see README.md).' >&2
  exit 1
fi
# A dedicated local database; never inherit a production database URL.
export DATABASE_URL="sqlite:///$ROOT/backend/local.db"
export APP_ENV=development
export ADMIN_TOKEN="${ADMIN_TOKEN:-local-development-only}"
export CORS_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
export PYTHONPATH="$ROOT/backend:$ROOT/admin"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
pids+=("$!")
# Wait for catalog seeding before the admin creates its tables.
ready=false
for ((i=0; i<60; i++)); do
  if curl --fail --silent http://127.0.0.1:8000/healthz >/dev/null; then ready=true; break; fi
  if ! kill -0 "${pids[0]}" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo 'Backend failed to start.' >&2; exit 1; fi
"$PY" -m uvicorn hearth_admin.main:app --host 127.0.0.1 --port 8100 &
pids+=("$!")
echo 'App: http://localhost:8081 | Admin: http://127.0.0.1:8100'
echo 'Admin token: use ADMIN_TOKEN if set, otherwise local-development-only'
cd "$ROOT/mobile"
EXPO_PUBLIC_API_URL=http://localhost:8000 npm run web -- --port 8081 &
pids+=("$!")
# Stop the other services if any child exits.
while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; exit 0; fi
  done
  sleep 1
done
