#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="16161616-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="16161616-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="16161616-cccc-4ccc-8ccc-cccccccccccc"
A_NONCE="16160000-0000-4000-8000-000000000001"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'delete-a@example.test'),
  ('${B}', 'delete-b@example.test'),
  ('${C}', 'delete-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'deletealpha', 'delete-a@example.test'),
  ('${B}', 'deletebravo', 'delete-b@example.test'),
  ('${C}', 'deletecharlie', 'delete-c@example.test')
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

AB_CONVERSATION="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${AB_CONVERSATION}" ]]

A_MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '${A_NONCE}'::uuid, 'shared history must survive');")"
[[ -n "${A_MESSAGE}" ]]

REQUEST_STATUS="$(user_scalar "${B}" "SELECT status FROM public.comic_request_account_deletion();")"
[[ "${REQUEST_STATUS}" == "deletion_requested" ]]

STATE_STATUS="$(user_scalar "${B}" "SELECT status FROM public.comic_get_my_account_state();")"
[[ "${STATE_STATUS}" == "deletion_requested" ]]

SEARCH_COUNT="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_search_users('deletebravo');")"
[[ "${SEARCH_COUNT}" == "0" ]]

if user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_search_users('deletealpha');" >/dev/null 2>&1; then
  echo "deletion-requested user unexpectedly retained search interaction" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);" >/dev/null 2>&1; then
  echo "active user unexpectedly reopened deletion-requested partner" >&2
  exit 1
fi

if user_scalar "${B}" "SELECT public.comic_ensure_direct_conversation('${A}'::uuid);" >/dev/null 2>&1; then
  echo "deletion-requested user unexpectedly opened a conversation" >&2
  exit 1
fi

RETRY_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '${A_NONCE}'::uuid, 'shared history must survive');")"
[[ "${RETRY_ID}" == "${A_MESSAGE}" ]]

A_JOB_COUNT="$( "${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_generation_job WHERE message_id = '${A_MESSAGE}'::uuid;" )"
[[ "${A_JOB_COUNT}" == "1" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '16160000-0000-4000-8000-000000000002'::uuid, 'must be blocked while partner is pending deletion');" >/dev/null 2>&1; then
  echo "new message to deletion-requested partner unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '16160000-0000-4000-8000-000000000003'::uuid, 'must be blocked for deletion-requested sender');" >/dev/null 2>&1; then
  echo "deletion-requested sender unexpectedly sent a new message" >&2
  exit 1
fi

B_EXPORT_HAS_HISTORY="$(user_scalar "${B}" "SELECT CASE WHEN POSITION('shared history must survive' IN public.comic_export_my_data()::TEXT) > 0 THEN 1 ELSE 0 END;")"
[[ "${B_EXPORT_HAS_HISTORY}" == "1" ]]

if "${PSQL[@]}" -c "DELETE FROM auth.users WHERE id = '${B}'::uuid;" >/dev/null 2>&1; then
  echo "raw auth-user deletion unexpectedly bypassed shared-history guard" >&2
  exit 1
fi

B_STILL_EXISTS="$( "${PSQL[@]}" -c "SELECT COUNT(*) FROM auth.users WHERE id = '${B}'::uuid;" )"
MESSAGE_STILL_EXISTS="$( "${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message WHERE id = '${A_MESSAGE}'::uuid;" )"
[[ "${B_STILL_EXISTS}" == "1" ]]
[[ "${MESSAGE_STILL_EXISTS}" == "1" ]]

C_CONVERSATION="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${C}'::uuid);")"
[[ -n "${C_CONVERSATION}" ]]

CANCEL_STATUS="$(user_scalar "${B}" "SELECT status FROM public.comic_cancel_account_deletion();")"
[[ "${CANCEL_STATUS}" == "active" ]]

SEARCH_COUNT_AFTER_CANCEL="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_search_users('deletebravo');")"
[[ "${SEARCH_COUNT_AFTER_CANCEL}" == "1" ]]

REOPENED="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ "${REOPENED}" == "${AB_CONVERSATION}" ]]

B_MESSAGE="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '16160000-0000-4000-8000-000000000004'::uuid, 'interaction restored after cancel');")"
[[ -n "${B_MESSAGE}" ]]

echo "PR-16 deletion-request boundary integration checks passed."
