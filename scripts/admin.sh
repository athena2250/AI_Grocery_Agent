#!/usr/bin/env bash
# Start the Hearth admin console and open it in the browser.
#
#   scripts/admin.sh          # the database on this Mac
#   scripts/admin.sh live     # your live families (the Render database)
#   scripts/admin.sh demo     # made-up families, safe to click around
#
# The admin token is made once and kept in ~/.hearth/admin_token (outside the repo). Each start
# copies it to the clipboard: paste it on the sign-in page. The live database address is asked
# for once and kept in ~/.hearth/live_database_url. Ctrl-C stops the console.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.hearth"
TOKEN_FILE="$DIR/admin_token"
LIVE_URL_FILE="$DIR/live_database_url"
PORT="${ADMIN_PORT:-8100}"
URL="http://127.0.0.1:$PORT"
PY="$ROOT/backend/.venv/bin"
MODE="${1:-local}"

[ -x "$PY/uvicorn" ] || { echo "Set up the backend first: cd backend && python3 -m venv .venv && .venv/bin/pip install -e ."; exit 1; }

mkdir -p "$DIR" && chmod 700 "$DIR"
if [ ! -s "$TOKEN_FILE" ]; then
  (umask 077; openssl rand -hex 24 > "$TOKEN_FILE")
fi
export ADMIN_TOKEN="$(cat "$TOKEN_FILE")"

case "$MODE" in
  live)
    if [ ! -s "$LIVE_URL_FILE" ]; then
      echo "First time: paste the live database address."
      echo "Render dashboard → hearth-db → Connect → External Database URL (starts with postgresql://)"
      read -r -s -p "> " live_url; echo
      [[ "$live_url" == postgres* ]] || { echo "That doesn't look like a database address."; exit 1; }
      (umask 077; printf '%s\n' "$live_url" > "$LIVE_URL_FILE")
    fi
    export DATABASE_URL="$(cat "$LIVE_URL_FILE")"
    LABEL="LIVE families (Render)"
    ;;
  local)
    unset DATABASE_URL
    LABEL="this Mac's database (ai_grocery_agent)"
    ;;
  demo)
    DEMO_DB="$ROOT/admin/demo.db"
    if [ ! -f "$DEMO_DB" ]; then
      echo "Making demo data…"
      (cd "$ROOT/admin" && PYTHONPATH=. "$PY/python" -m hearth_admin.demo "sqlite:///$DEMO_DB")
    fi
    export DATABASE_URL="sqlite:///$DEMO_DB"
    LABEL="demo data"
    ;;
  *)
    echo "Usage: scripts/admin.sh [local|live|demo]"; exit 1 ;;
esac

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Something is already running on port $PORT, probably the console. Opening it."
  echo "(To switch database, stop that one first with Ctrl-C in its window.)"
  printf '%s' "$ADMIN_TOKEN" | pbcopy 2>/dev/null || true
  open "$URL"
  exit 0
fi

printf '%s' "$ADMIN_TOKEN" | pbcopy 2>/dev/null && copied="copied to the clipboard" || copied="$ADMIN_TOKEN"
echo
echo "  Hearth admin · $LABEL"
echo "  $URL"
echo "  Token: $copied (paste it on the sign-in page)"
echo "  Ctrl-C to stop"
echo

# Open the browser once the server answers.
( for _ in $(seq 1 40); do
    curl -s -o /dev/null "$URL" && { open "$URL"; exit 0; }
    sleep 0.25
  done ) &

cd "$ROOT/admin"
PYTHONPATH=. exec "$PY/uvicorn" hearth_admin.main:app --host 127.0.0.1 --port "$PORT"
