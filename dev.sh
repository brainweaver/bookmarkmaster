#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

for port in 5173 5174; do
  pids="$(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    kill ${pids} 2>/dev/null || true
  fi
done

CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5174 --strictPort "$@"
