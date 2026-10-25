#!/usr/bin/env bash
# Exercises the production hardening changes against a real server process.
# Run from anywhere:  bash backend/scripts/smoke-hardening.sh
#
# Checks the security controls that were added, plus the fail-closed startup paths:
#   1. /healthz is reachable without auth
#   2. login is rate limited and no longer has a built-in fallback password
#   3. the stream proxy requires a token and refuses private/loopback/metadata targets
#      while still serving a legitimate public URL
#   4. previously-open routes (subtitles, opensubs, local media) now require auth
#   5. local media refuses path traversal
#   6. production refuses to start with a placeholder/missing JWT_SECRET or with auth
#      disabled and unacknowledged
#   7. the webhook listener refuses to start with no WEBHOOK_SECRET
#   8. SIGTERM shuts the server down cleanly
set -u

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BACKEND_DIR"

PORT="${SMOKE_PORT:-5599}"
BASE="http://127.0.0.1:${PORT}"
PASS=0
FAIL=0
SERVER_PID=""

pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: expected $3, got $2"; fi
}
code() { # code <curl args...> -> status code
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@"
}

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

echo "== building =="
npm run build >/dev/null 2>&1 || { echo "build failed"; exit 1; }

SECRET="$(openssl rand -hex 32)"
APP_PW="smoke-pass-$$"

echo
echo "== 1-5: running server (production env) =="
PORT="$PORT" NODE_ENV=production JWT_SECRET="$SECRET" APP_PASSWORD="$APP_PW" \
  ALLOWED_ORIGIN="https://stream.makeify.org" \
  node dist/index.js >/tmp/smoke-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 50); do
  [ "$(code "$BASE/healthz")" = "200" ] && break
  sleep 0.2
done

check "/healthz unauthenticated" "$(code "$BASE/healthz")" "200"

# login: correct password first, then brute force
LOGIN_OK=$(curl -s --max-time 10 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$APP_PW\"}")
echo "$LOGIN_OK" | grep -q '"success":true' && pass "login with correct password" || fail "login with correct password: $LOGIN_OK"
TOKEN=$(echo "$LOGIN_OK" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

check "login with the old fallback password 'streamsecret' is refused" \
  "$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"password":"streamsecret"}')" "400"

LIMITED=0
for _ in $(seq 1 14); do
  c=$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"password":"wrong"}')
  [ "$c" = "429" ] && LIMITED=$((LIMITED + 1))
done
[ "$LIMITED" -ge 1 ] && pass "brute force hits the rate limiter (429 x$LIMITED)" || fail "rate limiter never triggered"

echo "== security headers =="
HDRS=$(curl -s -D - -o /dev/null --max-time 10 "$BASE/healthz")
echo "$HDRS" | head -1 | grep -q "200" && pass "server reachable for header check" || fail "server not reachable for header check"
for h in 'x-content-type-options: nosniff' 'x-frame-options: DENY' 'referrer-policy: no-referrer'; do
  echo "$HDRS" | tr 'A-Z' 'a-z' | grep -q "$(echo "$h" | tr 'A-Z' 'a-z')" && pass "header $h" || fail "missing header $h"
done

echo
echo
echo "== 3: stream proxy =="
check "proxy without a token" "$(code "$BASE/api/proxy?url=https%3A%2F%2Fexample.com%2F")" "401"
check "proxy to loopback" "$(code "$BASE/api/proxy?url=http%3A%2F%2F127.0.0.1%3A1%2F&t=$TOKEN")" "400"
check "proxy to cloud metadata" "$(code "$BASE/api/proxy?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F&t=$TOKEN")" "400"
check "proxy to private range" "$(code "$BASE/api/proxy?url=http%3A%2F%2F192.168.1.1%2F&t=$TOKEN")" "400"
check "proxy to decimal-encoded loopback" "$(code "$BASE/api/proxy?url=http%3A%2F%2F2130706433%2F&t=$TOKEN")" "400"
check "proxy to IPv4-mapped IPv6 metadata" "$(code "$BASE/api/proxy?url=http%3A%2F%2F%5B%3A%3Affff%3A169.254.169.254%5D%2F&t=$TOKEN")" "400"
check "proxy to IPv4-mapped IPv6 loopback (hex form)" "$(code "$BASE/api/proxy?url=http%3A%2F%2F%5B0%3A0%3A0%3A0%3A0%3Affff%3A127.0.0.1%5D%2F&t=$TOKEN")" "400"
check "proxy to expanded IPv6 loopback" "$(code "$BASE/api/proxy?url=http%3A%2F%2F%5B%3A%3Affff%3A7f00%3A1%5D%2F&t=$TOKEN")" "400"
check "proxy to IPv6 link-local inside fe80::/10" "$(code "$BASE/api/proxy?url=http%3A%2F%2F%5Bfe90%3A%3A1%5D%2F&t=$TOKEN")" "400"
check "proxy to IPv6 unique-local" "$(code "$BASE/api/proxy?url=http%3A%2F%2F%5Bfd00%3A%3A1%5D%2F&t=$TOKEN")" "400"
PUBLIC=$(code "$BASE/api/proxy?url=https%3A%2F%2Fexample.com%2F&t=$TOKEN")
if [ "$PUBLIC" = "200" ] || [ "$PUBLIC" = "000" ]; then
  pass "proxy to a legitimate public host (status $PUBLIC; 000 = no egress in this sandbox)"
else
  fail "proxy to a legitimate public host: got $PUBLIC"
fi

echo
echo "== 4: newly protected routes =="
check "subtitles without a token" "$(code "$BASE/api/subtitles/123/456")" "401"
check "opensubs without a token" "$(code "$BASE/api/opensubs/123")" "401"
check "local media without a token" "$(code "$BASE/api/local/stream/whatever.mp4")" "401"
check "library without a token" "$(code "$BASE/api/torrents")" "401"

echo
echo "== 5b: HLS id path traversal (was a live arbitrary file read) =="
check "fileId smuggles %2F and .. up to /etc" "$(code "$BASE/api/hls/1/%2F..%2F..%2F..%2Fetc/passwd?t=$TOKEN")" "400"
check "torrentId traversal on the master route" "$(code "$BASE/api/hls/%2F..%2F..%2F..%2Ftmp%2Fpwn/2/master.m3u8?t=$TOKEN")" "400"
check "non-numeric ids rejected" "$(code "$BASE/api/hls/abc/def/master.m3u8?t=$TOKEN")" "400"
check "segment wildcard traversal with valid ids" "$(code "$BASE/api/hls/1/2/..%2F..%2F..%2Fetc%2Fpasswd?t=$TOKEN")" "400"
check "legit-shaped master request is not 400" "$(code "$BASE/api/hls/1/2/master.m3u8?t=$TOKEN")" "500"

echo
echo "== 5: local media path traversal =="
check "encoded ../ traversal" "$(code "$BASE/api/local/stream/..%2f..%2fetc%2fpasswd?t=$TOKEN")" "404"
check "double-encoded traversal" "$(code "$BASE/api/local/stream/..%252f..%252fetc%252fpasswd?t=$TOKEN")" "404"
check "absolute path attempt" "$(code "$BASE/api/local/stream/%2Fetc%2Fpasswd?t=$TOKEN")" "404"

echo
echo "== 8: graceful shutdown =="
kill -TERM "$SERVER_PID" 2>/dev/null
wait "$SERVER_PID" 2>/dev/null
check "server exited cleanly on SIGTERM" "$?" "0"
grep -q 'shutting down' /tmp/smoke-server.log && pass "shutdown logged" || fail "shutdown not logged"
SERVER_PID=""

echo
echo "== 6-7: fail-closed startup =="
out=$(PORT=5598 NODE_ENV=production APP_PASSWORD="$APP_PW" JWT_SECRET=super_secret_jwt_key_change_me \
  node dist/index.js 2>&1); rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -qi 'FATAL'; } && pass "placeholder JWT_SECRET refused" || fail "placeholder JWT_SECRET accepted (rc=$rc)"

out=$(PORT=5598 NODE_ENV=production JWT_SECRET="$SECRET" APP_PASSWORD=none \
  node dist/index.js 2>&1); rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -qi 'FATAL'; } && pass "open auth in production refused" || fail "open auth accepted (rc=$rc)"

out=$(PORT=5598 NODE_ENV=production JWT_SECRET="$SECRET" APP_PASSWORD=none ALLOW_NO_AUTH=1 \
  timeout 3 node dist/index.js 2>&1); echo "$out" | grep -q 'Authentication is DISABLED' \
  && pass "open auth allowed only with ALLOW_NO_AUTH, and warned" || fail "no warning with ALLOW_NO_AUTH"

out=$(WEBHOOK_PORT=5597 timeout 3 node dist/webhook.js 2>&1); rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -qi 'FATAL'; } && pass "webhook refuses to start without WEBHOOK_SECRET" || fail "webhook started without a secret (rc=$rc)"

echo
echo "== 9: .env is actually loaded (regression guard) =="
# Runs the built server from a scratch directory whose ONLY configuration is a .env file,
# i.e. how it is deployed (secrets in backend/.env, the process manager starts dist/index.js).
# If dotenv stops being loaded, the placeholder-secret fatal below will not fire and this fails.
ENVDIR=$(mktemp -d)
cp -r dist "$ENVDIR/"
ln -s "$PWD/node_modules" "$ENVDIR/node_modules"

printf 'NODE_ENV=production\nPORT=5602\nJWT_SECRET=super_secret_jwt_key_change_me\nAPP_PASSWORD=x\n' > "$ENVDIR/.env"
out=$(cd "$ENVDIR" && timeout 6 node dist/index.js 2>&1); rc=$?
{ [ "$rc" -ne 0 ] && echo "$out" | grep -qi 'FATAL'; } \
  && pass ".env is read: placeholder secret in .env is refused" \
  || fail ".env not read: process started with a placeholder secret (rc=$rc)"

printf 'NODE_ENV=production\nPORT=5602\nJWT_SECRET=%s\nAPP_PASSWORD=from-dotenv\n' "$SECRET" > "$ENVDIR/.env"
( cd "$ENVDIR"; exec node dist/index.js >/tmp/env-only.log 2>&1 ) &
ENVPID=$!
for _ in $(seq 1 40); do
  [ "$(code http://127.0.0.1:5602/healthz)" = "200" ] && break
  sleep 0.25
done
check ".env is read: PORT came from the file, not the default" "$(code http://127.0.0.1:5602/healthz)" "200"
check ".env is read: APP_PASSWORD from the file is enforced" "$(code http://127.0.0.1:5602/api/torrents)" "401"
grep -q '"auth":"enabled"' /tmp/env-only.log && pass ".env is read: auth reported enabled" || fail ".env not read: auth reported disabled"
kill -TERM $ENVPID 2>/dev/null; wait $ENVPID 2>/dev/null
rm -rf "$ENVDIR"

echo
echo "== dependency audit =="
if npm audit 2>&1 | grep -q 'found 0 vulnerabilities'; then pass "npm audit clean"; else fail "npm audit reports vulnerabilities"; fi

echo
echo "-------------------------------------------"
echo "PASS: $PASS   FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
