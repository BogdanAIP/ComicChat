#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="27272727-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="27272727-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="27272727-cccc-4ccc-8ccc-cccccccccccc"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr27-a@example.test'),
  ('${B}', 'pr27-b@example.test'),
  ('${C}', 'pr27-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'pr27alpha', 'pr27-a@example.test'),
  ('${B}', 'pr27bravo', 'pr27-b@example.test'),
  ('${C}', 'pr27charlie', 'pr27-c@example.test');
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

service_scalar() {
  local statement="$1"
  {
    cat <<SQL
SET ROLE service_role;
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

claim_and_fail() {
  local message_id="$1"
  local claimed job_id lease attempt

  claimed="$(service_scalar "SELECT id::text || '|' || lease_token::text || '|' || attempt_count::text FROM public.comic_claim_generation_job_for_message('${message_id}'::uuid, 'openai-image', 180);")"
  job_id="${claimed%%|*}"
  local rest="${claimed#*|}"
  lease="${rest%%|*}"
  attempt="${rest##*|}"
  [[ -n "${job_id}" && -n "${lease}" && -n "${attempt}" ]]

  local failed
  failed="$(service_scalar "SELECT status FROM public.comic_fail_generation_job(
    '${job_id}'::uuid,
    '${lease}'::uuid,
    'pr27_test_failure',
    NULL,
    FALSE
  );")"
  [[ "${failed}" == "failed" ]]
  printf '%s' "${attempt}"
}

retry_state() {
  local user_id="$1"
  local message_id="$2"
  local expected_attempt="$3"
  local request_id="$4"
  user_scalar "${user_id}" "SELECT status || '|' || attempt_count::text || '|' || max_attempts::text
  FROM public.comic_retry_failed_generation(
    '${message_id}'::uuid,
    ${expected_attempt},
    '${request_id}'::uuid
  );"
}

service_scalar "UPDATE public.comic_generation_config
SET external_generation_enabled = TRUE,
    provider = 'openai-image',
    billing_source = 'comicchat-sponsored-beta',
    updated_at = NOW()
WHERE singleton_id = 1
RETURNING provider;" >/dev/null

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${AB}" ]]

M1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message(
  '${AB}'::uuid,
  '27270000-0000-4000-8000-000000000001'::uuid,
  'manual retry accounting'
);")"

ATTEMPT1="$(claim_and_fail "${M1}")"
[[ "${ATTEMPT1}" == "1" ]]

R1="27271000-0000-4000-8000-000000000001"
STATE="$(retry_state "${A}" "${M1}" 1 "${R1}")"
[[ "${STATE}" == "queued|1|2" ]]

RETRY_LEDGER="$("${PSQL[@]}" -c "
SELECT count(*)::text
FROM public.comic_usage_ledger
WHERE message_id = '${M1}'::uuid
  AND event_type = 'retry_requested'
  AND request_id = '${R1}'::uuid;
")"
[[ "${RETRY_LEDGER}" == "1" ]]

ATTEMPT2="$(claim_and_fail "${M1}")"
[[ "${ATTEMPT2}" == "2" ]]

# Replaying the already accepted request ID after a later failure is forever a
# no-op: it must not queue attempt 3.
REPLAY="$(retry_state "${A}" "${M1}" 1 "${R1}")"
[[ "${REPLAY}" == "failed|2|2" ]]

R2="27271000-0000-4000-8000-000000000002"

# A stale expected-attempt value is also a no-op and does not consume the new
# request ID, so the caller can retry it with the current failed attempt.
STALE="$(retry_state "${A}" "${M1}" 1 "${R2}")"
[[ "${STALE}" == "failed|2|2" ]]

STATE="$(retry_state "${A}" "${M1}" 2 "${R2}")"
[[ "${STATE}" == "queued|2|3" ]]
ATTEMPT3="$(claim_and_fail "${M1}")"
[[ "${ATTEMPT3}" == "3" ]]

R3="27271000-0000-4000-8000-000000000003"
STATE="$(retry_state "${A}" "${M1}" 3 "${R3}")"
[[ "${STATE}" == "queued|3|4" ]]
ATTEMPT4="$(claim_and_fail "${M1}")"
[[ "${ATTEMPT4}" == "4" ]]

R4="27271000-0000-4000-8000-000000000004"
STATE="$(retry_state "${A}" "${M1}" 4 "${R4}")"
[[ "${STATE}" == "queued|4|5" ]]
ATTEMPT5="$(claim_and_fail "${M1}")"
[[ "${ATTEMPT5}" == "5" ]]

if retry_state "${A}" "${M1}" 5 "27271000-0000-4000-8000-000000000005" >/dev/null 2>&1; then
  echo "attempt 6 unexpectedly passed the hard generation retry limit" >&2
  exit 1
fi

TOTAL_RETRY_REQUESTS="$("${PSQL[@]}" -c "
SELECT count(*)::text
FROM public.comic_usage_ledger
WHERE message_id = '${M1}'::uuid
  AND event_type = 'retry_requested';
")"
[[ "${TOTAL_RETRY_REQUESTS}" == "4" ]]

if retry_state "${C}" "${M1}" 5 "27271000-0000-4000-8000-000000000006" >/dev/null 2>&1; then
  echo "foreign user unexpectedly retried another sender's generation" >&2
  exit 1
fi

# A second failed message exercises safety/provider gates without disturbing
# the attempt-limit fixture above.
M2="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message(
  '${AB}'::uuid,
  '27270000-0000-4000-8000-000000000002'::uuid,
  'retry safety gates'
);")"
[[ "$(claim_and_fail "${M2}")" == "1" ]]

service_scalar "UPDATE public.comic_generation_config
SET external_generation_enabled = FALSE, updated_at = NOW()
WHERE singleton_id = 1
RETURNING external_generation_enabled::text;" >/dev/null

if retry_state "${A}" "${M2}" 1 "27272000-0000-4000-8000-000000000001" >/dev/null 2>&1; then
  echo "retry unexpectedly succeeded while provider was disabled" >&2
  exit 1
fi

service_scalar "UPDATE public.comic_generation_config
SET external_generation_enabled = TRUE, updated_at = NOW()
WHERE singleton_id = 1
RETURNING external_generation_enabled::text;" >/dev/null

user_scalar "${B}" "SELECT public.comic_block_user('${A}'::uuid);" >/dev/null
if retry_state "${A}" "${M2}" 1 "27272000-0000-4000-8000-000000000002" >/dev/null 2>&1; then
  echo "retry unexpectedly bypassed conversation blocking" >&2
  exit 1
fi
user_scalar "${B}" "SELECT public.comic_unblock_user('${A}'::uuid);" >/dev/null

user_scalar "${A}" "SELECT status FROM public.comic_request_account_deletion();" >/dev/null
if retry_state "${A}" "${M2}" 1 "27272000-0000-4000-8000-000000000003" >/dev/null 2>&1; then
  echo "deletion-requested sender unexpectedly retried generation" >&2
  exit 1
fi
user_scalar "${A}" "SELECT status FROM public.comic_cancel_account_deletion();" >/dev/null

user_scalar "${B}" "SELECT status FROM public.comic_request_account_deletion();" >/dev/null
if retry_state "${A}" "${M2}" 1 "27272000-0000-4000-8000-000000000004" >/dev/null 2>&1; then
  echo "retry unexpectedly bypassed unavailable conversation partner" >&2
  exit 1
fi
user_scalar "${B}" "SELECT status FROM public.comic_cancel_account_deletion();" >/dev/null

FINAL_STATE="$(retry_state "${A}" "${M2}" 1 "27272000-0000-4000-8000-000000000005")"
[[ "${FINAL_STATE}" == "queued|1|2" ]]

echo "PR-27 sender-controlled generation retry checks passed."
