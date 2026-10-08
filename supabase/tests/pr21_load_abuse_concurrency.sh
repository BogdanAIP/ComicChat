#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

if [[ "${1:-}" == "--send" ]]; then
  user_id="${2:?user id required}"
  conversation_id="${3:?conversation id required}"
  nonce="${4:?nonce required}"
  message_text="${5:?message text required}"

  {
    cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${user_id}', false);
SELECT id
FROM public.comic_send_message(
  '${conversation_id}'::uuid,
  '${nonce}'::uuid,
  '${message_text}'
);
SQL
  } | "${PSQL[@]}" | tail -n 1
  exit 0
fi

A="21212121-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="21212121-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="21212121-cccc-4ccc-8ccc-cccccccccccc"
D="21212121-dddd-4ddd-8ddd-dddddddddddd"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'load-a@example.test'),
  ('${B}', 'load-b@example.test'),
  ('${C}', 'load-c@example.test'),
  ('${D}', 'load-d@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'loadalpha', 'load-a@example.test'),
  ('${B}', 'loadbravo', 'load-b@example.test'),
  ('${C}', 'loadcharlie', 'load-c@example.test'),
  ('${D}', 'loaddelta', 'load-d@example.test')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  email = EXCLUDED.email;
SQL

user_scalar() {
  local user_id="$1"
  local statement="$2"

  {
    cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${user_id}', false);
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
CD="$(user_scalar "${C}" "SELECT public.comic_ensure_direct_conversation('${D}'::uuid);")"
[[ -n "${AB}" && -n "${CD}" ]]

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
MAX_PARALLEL=12

throttle() {
  while (( $(jobs -pr | wc -l) >= MAX_PARALLEL )); do
    wait -n || true
  done
}

launch_send() {
  local label="$1"
  local user_id="$2"
  local conversation_id="$3"
  local nonce="$4"
  local message_text="$5"

  (
    if bash "$0" --send       "$user_id"       "$conversation_id"       "$nonce"       "$message_text"       >"$TMP_DIR/${label}.out"       2>"$TMP_DIR/${label}.err"; then
      echo ok >"$TMP_DIR/${label}.status"
    else
      echo fail >"$TMP_DIR/${label}.status"
    fi
  ) &
  throttle
}

count_status() {
  local pattern="$1"
  local wanted="$2"
  local count=0
  local file

  for file in $pattern; do
    [[ -e "$file" ]] || continue
    if [[ "$(cat "$file")" == "$wanted" ]]; then
      count=$((count + 1))
    fi
  done

  printf '%s\n' "$count"
}

# Burst two senders concurrently. A deliberately exceeds the 30/60 quota,
# while B stays below it. The sender-scoped advisory lock must prevent A from
# racing past 30 without turning B's independent quota into a global lock.
for i in $(seq 1 40); do
  a_nonce="$(printf '21100000-0000-4000-8000-%012x' "$i")"
  launch_send "a-${i}" "$A" "$AB" "$a_nonce" "A burst ${i}"

  if (( i <= 8 )); then
    b_nonce="$(printf '21200000-0000-4000-8000-%012x' "$i")"
    launch_send "b-${i}" "$B" "$AB" "$b_nonce" "B burst ${i}"
  fi
done
wait

A_OK="$(count_status "$TMP_DIR/a-*.status" ok)"
A_FAIL="$(count_status "$TMP_DIR/a-*.status" fail)"
B_OK="$(count_status "$TMP_DIR/b-*.status" ok)"
B_FAIL="$(count_status "$TMP_DIR/b-*.status" fail)"

[[ "$A_OK" == "30" ]]
[[ "$A_FAIL" == "10" ]]
[[ "$B_OK" == "8" ]]
[[ "$B_FAIL" == "0" ]]

A_RATE_LIMITED=0
for file in "$TMP_DIR"/a-*.err; do
  if grep -q 'send_rate_limited' "$file"; then
    A_RATE_LIMITED=$((A_RATE_LIMITED + 1))
  fi
done
[[ "$A_RATE_LIMITED" == "10" ]]

A_RECENT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id = '${A}'::uuid AND created_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds';")"
B_RECENT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id = '${B}'::uuid AND created_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds';")"
[[ "$A_RECENT" == "30" ]]
[[ "$B_RECENT" == "8" ]]

BURST_MESSAGES="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id IN ('${A}'::uuid, '${B}'::uuid);")"
BURST_JOBS="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_generation_job WHERE sender_id IN ('${A}'::uuid, '${B}'::uuid);")"
BURST_QUEUED_LEDGER="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE sender_id IN ('${A}'::uuid, '${B}'::uuid) AND attempt_no = 0 AND event_type = 'queued';")"
[[ "$BURST_MESSAGES" == "38" ]]
[[ "$BURST_JOBS" == "38" ]]
[[ "$BURST_QUEUED_LEDGER" == "38" ]]

MISSING_JOB="$("${PSQL[@]}" -c "
SELECT COUNT(*)
FROM public.comic_message AS m
LEFT JOIN public.comic_generation_job AS j
  ON j.message_id = m.id
WHERE m.sender_id IN ('${A}'::uuid, '${B}'::uuid)
  AND j.id IS NULL;
")"
[[ "$MISSING_JOB" == "0" ]]

# Twenty concurrent exact retries must collapse to one logical message, one
# generation job, and one queued usage-ledger event.
RETRY_NONCE="21300000-0000-4000-8000-000000000001"
for i in $(seq 1 20); do
  launch_send "retry-${i}" "$C" "$CD" "$RETRY_NONCE" "same logical message"
done
wait

RETRY_OK="$(count_status "$TMP_DIR/retry-*.status" ok)"
RETRY_FAIL="$(count_status "$TMP_DIR/retry-*.status" fail)"
[[ "$RETRY_OK" == "20" ]]
[[ "$RETRY_FAIL" == "0" ]]

RETRY_UNIQUE_IDS="$(cat "$TMP_DIR"/retry-*.out | sort -u | wc -l | tr -d ' ')"
[[ "$RETRY_UNIQUE_IDS" == "1" ]]
RETRY_ID="$(head -n 1 "$TMP_DIR"/retry-1.out)"
[[ -n "$RETRY_ID" ]]

RETRY_MESSAGES="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id = '${C}'::uuid AND client_nonce = '${RETRY_NONCE}'::uuid;")"
RETRY_JOBS="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_generation_job WHERE message_id = '${RETRY_ID}'::uuid;")"
RETRY_LEDGER="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE message_id = '${RETRY_ID}'::uuid AND attempt_no = 0 AND event_type = 'queued';")"
[[ "$RETRY_MESSAGES" == "1" ]]
[[ "$RETRY_JOBS" == "1" ]]
[[ "$RETRY_LEDGER" == "1" ]]

# Two changed payloads racing on the same fresh nonce must result in exactly one
# message and one nonce conflict, never two logical messages.
RACE_NONCE="21400000-0000-4000-8000-000000000001"
launch_send "race-one" "$C" "$CD" "$RACE_NONCE" "race payload one"
launch_send "race-two" "$C" "$CD" "$RACE_NONCE" "race payload two"
wait

RACE_OK="$(count_status "$TMP_DIR/race-*.status" ok)"
RACE_FAIL="$(count_status "$TMP_DIR/race-*.status" fail)"
[[ "$RACE_OK" == "1" ]]
[[ "$RACE_FAIL" == "1" ]]

RACE_CONFLICTS=0
for file in "$TMP_DIR"/race-*.err; do
  if grep -q 'client_nonce_conflict' "$file"; then
    RACE_CONFLICTS=$((RACE_CONFLICTS + 1))
  fi
done
[[ "$RACE_CONFLICTS" == "1" ]]

RACE_MESSAGES="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id = '${C}'::uuid AND client_nonce = '${RACE_NONCE}'::uuid;")"
RACE_JOBS="$("${PSQL[@]}" -c "
SELECT COUNT(*)
FROM public.comic_generation_job AS j
JOIN public.comic_message AS m ON m.id = j.message_id
WHERE m.sender_id = '${C}'::uuid
  AND m.client_nonce = '${RACE_NONCE}'::uuid;
")"
[[ "$RACE_MESSAGES" == "1" ]]
[[ "$RACE_JOBS" == "1" ]]

echo "PR-21 deterministic load/abuse concurrency checks passed."
