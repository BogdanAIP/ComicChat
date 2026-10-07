#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="dddddddd-dddd-4ddd-8ddd-ddddddddddd4"
B="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5"
OTHER_NONCE="14eeeeee-0000-4000-8000-000000000001"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'rate-a@example.test'),
  ('${B}', 'rate-b@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'ratealpha', 'rate-a@example.test'),
  ('${B}', 'ratebravo', 'rate-b@example.test');
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

CONVERSATION_ID="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${CONVERSATION_ID}" ]]

LAST_ID=""
LAST_NONCE=""

for i in $(seq 1 30); do
  nonce="$(printf '14000000-0000-4000-8000-%012x' "$i")"
  message_id="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${nonce}'::uuid, 'rate message ${i}');")"
  [[ -n "${message_id}" ]]
  LAST_ID="${message_id}"
  LAST_NONCE="${nonce}"
done

RECENT_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE sender_id = '${A}'::uuid AND created_at > CURRENT_TIMESTAMP - INTERVAL '60 seconds';")"
[[ "${RECENT_COUNT}" == "30" ]]

RETRY_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${LAST_NONCE}'::uuid, 'rate message 30');")"
[[ "${RETRY_ID}" == "${LAST_ID}" ]]

LAST_JOB_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_generation_job WHERE message_id = '${LAST_ID}'::uuid;")"
[[ "${LAST_JOB_COUNT}" == "1" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '14000000-0000-4000-8000-000000000031'::uuid, 'rate message 31');" >/dev/null 2>&1; then
  echo "31st new message inside the rolling minute unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${LAST_NONCE}'::uuid, 'changed retry payload');" >/dev/null 2>&1; then
  echo "nonce conflict bypassed the send rate limit boundary" >&2
  exit 1
fi

OTHER_ID="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${OTHER_NONCE}'::uuid, 'other sender remains independent');")"
[[ -n "${OTHER_ID}" ]]

"${PSQL[@]}" -c "UPDATE public.comic_message SET created_at = created_at - INTERVAL '61 seconds' WHERE sender_id = '${A}'::uuid;" >/dev/null

AFTER_WINDOW_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '14000000-0000-4000-8000-000000000031'::uuid, 'rate message 31');")"
[[ -n "${AFTER_WINDOW_ID}" ]]

echo "PR-14 atomic send rate-limit integration checks passed."
