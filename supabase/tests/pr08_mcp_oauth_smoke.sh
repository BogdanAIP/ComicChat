#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-http://127.0.0.1:54321/functions/v1/comicchat-mcp}"
headers="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$headers" "$body"' EXIT

payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"comicchat-pr08-smoke","version":"0.1.0"}}}'

status=""
for _ in $(seq 1 40); do
  status="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' \
    -X POST "$base_url" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$payload" || true)"

  if [[ "$status" == "401" ]]; then
    break
  fi
  sleep 2
done

if [[ "$status" != "401" ]]; then
  echo "Expected unauthenticated MCP initialize to return 401, got: $status" >&2
  cat "$headers" >&2 || true
  cat "$body" >&2 || true
  exit 1
fi

challenge="$(tr -d '\r' < "$headers" | grep -i '^www-authenticate:' | head -n1 || true)"
if [[ "$challenge" != *"Bearer"* || "$challenge" != *"resource_metadata="* ]]; then
  echo "Missing OAuth protected-resource challenge: $challenge" >&2
  exit 1
fi

metadata_url="$(printf '%s' "$challenge" | sed -n 's/.*resource_metadata="\([^"]*\)".*/\1/p')"
if [[ -z "$metadata_url" ]]; then
  echo "Unable to parse resource_metadata URL from: $challenge" >&2
  exit 1
fi

metadata="$(curl -fsS "$metadata_url")"
node -e '
  const doc = JSON.parse(process.argv[1]);
  if (typeof doc.resource !== "string" || !doc.resource) process.exit(2);
  if (!Array.isArray(doc.authorization_servers) || doc.authorization_servers.length < 1) process.exit(3);
' "$metadata"

echo "PR-08 MCP OAuth discovery smoke: PASS"
