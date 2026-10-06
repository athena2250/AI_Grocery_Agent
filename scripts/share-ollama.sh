#!/usr/bin/env bash
# Let the Hearth server online use the Ollama on this Mac.
#
#   scripts/share-ollama.sh            # keep this window open; Ctrl-C stops sharing
#
# Starts, in order: Ollama (if not running), the locked gate in front of it (app/ollama_gate.py,
# port 11435), and a tunnel to the gate. Keeps the Mac awake while it runs. Prints the two
# values to paste into the server's settings: OLLAMA_HOST and OLLAMA_API_KEY.
#
# Tunnel: with NGROK_DOMAIN set (a free static domain from ngrok.com), the address never
# changes — use that for the family. Without it, a free Cloudflare "quick tunnel" is used, whose
# address changes every time this script starts (fine for trying it out).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="${OLLAMA_MODEL:-llama3:8b}"
TOKEN_FILE="$HOME/.hearth/ollama_gate_token"   # outside the repo: never committed

command -v ollama >/dev/null || { echo "Install Ollama first: https://ollama.com/download"; exit 1; }
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null; then
  echo "Starting Ollama…"; (ollama serve >/tmp/hearth-ollama.log 2>&1 &); sleep 3
fi
ollama list | grep -q "^${MODEL%%:*}" || { echo "Pulling $MODEL…"; ollama pull "$MODEL"; }

mkdir -p "$(dirname "$TOKEN_FILE")"; chmod 700 "$(dirname "$TOKEN_FILE")"
[ -s "$TOKEN_FILE" ] || python3 -c "import secrets; print(secrets.token_urlsafe(36))" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
export OLLAMA_GATE_TOKEN="$(cat "$TOKEN_FILE")"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting the gate on 127.0.0.1:11435…"
(cd "$ROOT/backend" && .venv/bin/uvicorn app.ollama_gate:gate --host 127.0.0.1 --port 11435 --log-level warning) &
caffeinate -dimsu -w $$ &   # keep the Mac awake while sharing
sleep 2

if [ -n "${NGROK_DOMAIN:-}" ]; then
  command -v ngrok >/dev/null || { echo "brew install ngrok, then: ngrok config add-authtoken <your token>"; exit 1; }
  URL="https://$NGROK_DOMAIN"
  ngrok http --url="$NGROK_DOMAIN" 11435 --log=stdout >/tmp/hearth-tunnel.log 2>&1 &
else
  command -v cloudflared >/dev/null || { echo "brew install cloudflared  (or set NGROK_DOMAIN)"; exit 1; }
  cloudflared tunnel --no-autoupdate --url http://127.0.0.1:11435 >/tmp/hearth-tunnel.log 2>&1 &
  for _ in $(seq 1 30); do
    URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/hearth-tunnel.log | head -1 || true)"
    [ -n "$URL" ] && break; sleep 1
  done
fi
[ -n "${URL:-}" ] || { echo "Tunnel didn't start; see /tmp/hearth-tunnel.log"; exit 1; }

cat <<MSG

Sharing Ollama ($MODEL). Put these in the server's environment (Render → hearth-api → Environment):

  OLLAMA_HOST=$URL
  OLLAMA_API_KEY=$OLLAMA_GATE_TOKEN
  OLLAMA_MODEL=$MODEL

Keep this window open. If the Mac sleeps or this stops, the app still works — it just
answers with its built-in rules until Ollama is back.
MSG
wait
