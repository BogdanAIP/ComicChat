#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

D="44444444-4444-4444-8444-444444444444"
E="55555555-5555-4555-8555-555555555555"
F="66666666-6666-4666-8666-666666666666"
NONCE1="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
NONCE2="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${D}', 'delta@example.test'),
  ('${E}', 'echo@example.test'),
  ('${F}', 'foxtrot@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${D}', 'delta', 'delta@example.test'),
  ('${E}', 'echo', 'echo@example.test'),
  ('${F}', 'foxtrot', 'foxtrot@example.test')
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

service_scalar() {
  local statement="$1"

  {
    cat <<SQL
SET ROLE service_role;
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

claim_for_message() {
  local message_id="$1"

  service_scalar "SELECT id::text || '|' || lease_token::text || '|' || attempt_count::text FROM public.comic_claim_generation_job('mock', 60) WHERE message_id = '${message_id}'::uuid;"
}

CONVERSATION_ID="$(user_scalar "${D}" "SELECT public.comic_ensure_direct_conversation('${E}'::uuid);")"
[[ -n "${CONVERSATION_ID}" ]]

MESSAGE1="$(user_scalar "${D}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE1}'::uuid, 'first queued comic');")"
[[ -n "${MESSAGE1}" ]]

DUPLICATE1="$(user_scalar "${D}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE1}'::uuid, 'first queued comic');")"
[[ "${MESSAGE1}" == "${DUPLICATE1}" ]]

JOB1="$("${PSQL[@]}" -c "SELECT id FROM public.comic_generation_job WHERE message_id = '${MESSAGE1}'::uuid;")"
[[ -n "${JOB1}" ]]

JOB_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_generation_job WHERE message_id = '${MESSAGE1}'::uuid;")"
[[ "${JOB_COUNT}" == "1" ]]

QUEUED_LEDGER="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE job_id = '${JOB1}'::uuid AND attempt_no = 0 AND event_type = 'queued';")"
[[ "${QUEUED_LEDGER}" == "1" ]]

ATTRIBUTION="$("${PSQL[@]}" -c "SELECT sender_id::text || '|' || provider || '|' || billing_source FROM public.comic_generation_job WHERE id = '${JOB1}'::uuid;")"
[[ "${ATTRIBUTION}" == "${D}|mock|mock" ]]

D_JOB_VISIBLE="$(user_scalar "${D}" "SELECT COUNT(*) FROM public.comic_generation_job WHERE id = '${JOB1}'::uuid;")"
E_JOB_VISIBLE="$(user_scalar "${E}" "SELECT COUNT(*) FROM public.comic_generation_job WHERE id = '${JOB1}'::uuid;")"
F_JOB_VISIBLE="$(user_scalar "${F}" "SELECT COUNT(*) FROM public.comic_generation_job WHERE id = '${JOB1}'::uuid;")"
[[ "${D_JOB_VISIBLE}" == "1" ]]
[[ "${E_JOB_VISIBLE}" == "0" ]]
[[ "${F_JOB_VISIBLE}" == "0" ]]

if user_scalar "${D}" "UPDATE public.comic_generation_job SET status = 'ready' WHERE id = '${JOB1}'::uuid;" >/dev/null 2>&1; then
  echo "authenticated sender unexpectedly updated generation job directly" >&2
  exit 1
fi

if user_scalar "${D}" "SELECT id FROM public.comic_claim_generation_job('mock', 60);" >/dev/null 2>&1; then
  echo "authenticated sender unexpectedly executed worker claim RPC" >&2
  exit 1
fi

CLAIM1="$(claim_for_message "${MESSAGE1}")"
IFS='|' read -r CLAIM1_ID LEASE1 ATTEMPT1 <<< "${CLAIM1}"
[[ "${CLAIM1_ID}" == "${JOB1}" ]]
[[ "${ATTEMPT1}" == "1" ]]
[[ -n "${LEASE1}" ]]

MESSAGE1_RENDERING="$("${PSQL[@]}" -c "SELECT status FROM public.comic_message WHERE id = '${MESSAGE1}'::uuid;")"
[[ "${MESSAGE1_RENDERING}" == "rendering" ]]

FAIL1="$(service_scalar "SELECT status FROM public.comic_fail_generation_job('${JOB1}'::uuid, '${LEASE1}'::uuid, 'mock_transient', 'retry once', true);")"
[[ "${FAIL1}" == "queued" ]]

CLAIM2="$(claim_for_message "${MESSAGE1}")"
IFS='|' read -r CLAIM2_ID LEASE2 ATTEMPT2 <<< "${CLAIM2}"
[[ "${CLAIM2_ID}" == "${JOB1}" ]]
[[ "${ATTEMPT2}" == "2" ]]

READY1="$(service_scalar "SELECT status FROM public.comic_complete_generation_job('${JOB1}'::uuid, '${LEASE2}'::uuid, '{\"kind\":\"mock-comic-art\",\"version\":1}'::jsonb);")"
[[ "${READY1}" == "ready" ]]

MESSAGE1_READY="$("${PSQL[@]}" -c "SELECT status FROM public.comic_message WHERE id = '${MESSAGE1}'::uuid;")"
[[ "${MESSAGE1_READY}" == "ready" ]]

LEDGER_SEQUENCE="$("${PSQL[@]}" -c "SELECT string_agg(attempt_no::text || ':' || event_type, ',' ORDER BY recorded_at, event_type) FROM public.comic_usage_ledger WHERE job_id = '${JOB1}'::uuid;")"
for expected in "0:queued" "1:started" "1:failed" "1:retry_scheduled" "2:started" "2:succeeded"; do
  grep -q "${expected}" <<<"${LEDGER_SEQUENCE}"
done

D_LEDGER_VISIBLE="$(user_scalar "${D}" "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE job_id = '${JOB1}'::uuid;")"
E_LEDGER_VISIBLE="$(user_scalar "${E}" "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE job_id = '${JOB1}'::uuid;")"
[[ "${D_LEDGER_VISIBLE}" == "6" ]]
[[ "${E_LEDGER_VISIBLE}" == "0" ]]

if service_scalar "SELECT status FROM public.comic_complete_generation_job('${JOB1}'::uuid, '${LEASE2}'::uuid, '{}'::jsonb);" >/dev/null 2>&1; then
  echo "stale generation lease completed the same job twice" >&2
  exit 1
fi

MESSAGE2="$(user_scalar "${D}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE2}'::uuid, 'bounded retry comic');")"
JOB2="$("${PSQL[@]}" -c "SELECT id FROM public.comic_generation_job WHERE message_id = '${MESSAGE2}'::uuid;")"

for attempt in 1 2 3; do
  CLAIM="$(claim_for_message "${MESSAGE2}")"
  IFS='|' read -r CLAIM_ID LEASE ATTEMPT_NO <<< "${CLAIM}"
  [[ "${CLAIM_ID}" == "${JOB2}" ]]
  [[ "${ATTEMPT_NO}" == "${attempt}" ]]

  STATUS="$(service_scalar "SELECT status FROM public.comic_fail_generation_job('${JOB2}'::uuid, '${LEASE}'::uuid, 'mock_failure', 'bounded retry test', true);")"

  if [[ "${attempt}" -lt 3 ]]; then
    [[ "${STATUS}" == "queued" ]]
  else
    [[ "${STATUS}" == "failed" ]]
  fi
done

MESSAGE2_FAILED="$("${PSQL[@]}" -c "SELECT status FROM public.comic_message WHERE id = '${MESSAGE2}'::uuid;")"
[[ "${MESSAGE2_FAILED}" == "failed" ]]

TERMINAL_JOB="$("${PSQL[@]}" -c "SELECT status || '|' || attempt_count::text || '|' || max_attempts::text FROM public.comic_generation_job WHERE id = '${JOB2}'::uuid;")"
[[ "${TERMINAL_JOB}" == "failed|3|3" ]]

echo "PR-05 generation queue, sender attribution, idempotency and bounded retry checks passed."
