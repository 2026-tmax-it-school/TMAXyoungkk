#!/usr/bin/env bash
# 이 맥북에서 앱과 API 서버를 열고 https 터널로 다른 기기에서 접속하게 한다(2026-10-17).
#   npm run public        → 서버(8787) + 터널 → 앱 웹(8090) + 터널. 마지막에 접속 주소를 보여 준다. Ctrl+C로 모두 끈다.
# 필요한 것: cloudflared(brew install cloudflared). 서버 .env(DATABASE_URL·키)는 서버가 알아서 읽는다(이 스크립트는 읽지 않는다).
# 주소는 실행할 때마다 바뀐다. 개발용 보낸편지함은 이 컴퓨터에서 바로 연 요청만 읽는다(터널로 온 요청은 404).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v cloudflared >/dev/null || { echo "cloudflared가 없어요: brew install cloudflared"; exit 1; }
LOG=$(mktemp -d)
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

tunnel_url() { # $1=로그 파일
  for _ in $(seq 1 40); do
    u=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$1" 2>/dev/null | head -1 || true)
    [ -n "$u" ] && { echo "$u"; return; }
    sleep 1
  done
  echo "터널 주소를 못 받았어요: $1" >&2; exit 1
}

PORT=${PORT:-8787} AUTH_DEV_OUTBOX=1 npm run server > "$LOG/server.log" 2>&1 & PIDS+=($!)
sleep 4
cloudflared tunnel --url "http://localhost:8787" --no-autoupdate > "$LOG/cf-api.log" 2>&1 & PIDS+=($!)
API=$(tunnel_url "$LOG/cf-api.log")
EXPO_PUBLIC_API_URL="$API" EXPO_PUBLIC_SYNC_URL="$API" EXPO_PUBLIC_AI_PROXY_URL= npm run web > "$LOG/web.log" 2>&1 & PIDS+=($!)
sleep 20
cloudflared tunnel --url "http://localhost:8090" --no-autoupdate > "$LOG/cf-web.log" 2>&1 & PIDS+=($!)
WEB=$(tunnel_url "$LOG/cf-web.log")
# 터널이 도는 동안 맥북이 잠들지 않게 한다(덮개를 닫으면 잠든다)
command -v caffeinate >/dev/null && { caffeinate -i -s -w "${PIDS[2]}" & PIDS+=($!); }
echo
echo "다른 기기에서 열 주소:  $WEB"
echo "API 서버 주소:          $API"
echo "로그: $LOG   (Ctrl+C로 모두 끈다)"
wait
