#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:54321/functions/v1/comicchat-render}"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

status="$(curl -sS -o "$body_file" -w '%{http_code}'   -X POST   -H 'content-type: application/json'   --data '{"messageId":"25250000-0000-4000-8000-000000000025"}'   "$BASE_URL")"

if [[ "$status" != "401" ]]; then
  echo "Expected unauthenticated render request to return 401, got $status" >&2
  cat "$body_file" >&2 || true
  exit 1
fi

grep -q '"error":"not_authenticated"' "$body_file"

echo "PR-25 render Edge Runtime boot/auth smoke passed."
