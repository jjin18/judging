#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "${NODE_ENV:-development}" = "production" ] || [ "${1:-}" = "prod" ]; then
  echo "[start] production mode"
  if [ ! -d frontend/dist ]; then
    echo "[start] building frontend…"
    (cd frontend && npm install && npm run build)
  fi
  exec uvicorn main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8000}"
fi

echo "[start] dev mode — backend on :8000, frontend on :5173"

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000) &
BACKEND_PID=$!

if [ ! -d frontend/node_modules ]; then
  echo "[start] installing frontend deps…"
  (cd frontend && npm install)
fi

(cd frontend && npm run dev) &
FRONTEND_PID=$!

wait
