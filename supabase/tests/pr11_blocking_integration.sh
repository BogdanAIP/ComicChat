#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="77777777-7777-4777-8777-777777777777"
B="88888888-8888-4888-8888-888888888888"
C="99999999-9999-4999-8999-999999999999"
BEFORE_NONCE="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
BLOCKED_NONCE_A="dddddddd-dddd-4ddd-8ddd-dddddddddddd"
BLOCKED_NONCE_B="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
AFTER_NONCE="ffffffff-ffff-4fff-8fff-ffffffffffff"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'block-a@example.test'),
  ('${B}', 'block-b@example.test'),
  ('${C}', 'block-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'blockalpha', 'block-a@example.test'),
  ('${B}', 'blockbravo', 'block-b@example.test'),
  ('${C}', 'blockcharlie', 'block-c@example.test');
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

MESSAGE_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${BEFORE_NONCE}'::uuid, 'before block');")"
[[ -n "${MESSAGE_ID}" ]]

BLOCKED="$(user_scalar "${A}" "SELECT public.comic_block_user('${B}'::uuid);")"
[[ "${BLOCKED}" == "t" ]]

A_BLOCK_COUNT="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_user_block WHERE blocked_id = '${B}'::uuid;")"
[[ "${A_BLOCK_COUNT}" == "1" ]]

B_BLOCK_VISIBILITY="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_user_block WHERE blocker_id = '${A}'::uuid;")"
[[ "${B_BLOCK_VISIBILITY}" == "0" ]]

A_LISTED_BLOCKS="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_list_blocked_users() WHERE blocked_user_id = '${B}'::uuid;")"
[[ "${A_LISTED_BLOCKS}" == "1" ]]

A_SEARCH_B="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_search_users('blockbravo');")"
[[ "${A_SEARCH_B}" == "0" ]]

B_SEARCH_A="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_search_users('blockalpha');")"
[[ "${B_SEARCH_A}" == "0" ]]

RETRY_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${BEFORE_NONCE}'::uuid, 'before block');")"
[[ "${RETRY_ID}" == "${MESSAGE_ID}" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${BEFORE_NONCE}'::uuid, 'changed after block');" >/dev/null 2>&1; then
  echo "blocked retry with conflicting text bypassed nonce conflict" >&2
  exit 1
fi

A_SEARCH_C="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_search_users('blockcharlie');")"
[[ "${A_SEARCH_C}" == "1" ]]

if user_scalar "${B}" "SELECT public.comic_ensure_direct_conversation('${A}'::uuid);" >/dev/null 2>&1; then
  echo "blocked partner reopened a direct conversation" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${BLOCKED_NONCE_A}'::uuid, 'blocked from A');" >/dev/null 2>&1; then
  echo "blocker sent a message while interaction was blocked" >&2
  exit 1
fi

if user_scalar "${B}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${BLOCKED_NONCE_B}'::uuid, 'blocked from B');" >/dev/null 2>&1; then
  echo "blocked user sent a message while interaction was blocked" >&2
  exit 1
fi

VISIBLE_TO_A="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_message WHERE id = '${MESSAGE_ID}'::uuid;")"
VISIBLE_TO_B="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_message WHERE id = '${MESSAGE_ID}'::uuid;")"
[[ "${VISIBLE_TO_A}" == "1" ]]
[[ "${VISIBLE_TO_B}" == "1" ]]

if user_scalar "${A}" "INSERT INTO public.comic_user_block(blocker_id, blocked_id) VALUES ('${A}'::uuid, '${C}'::uuid);" >/dev/null 2>&1; then
  echo "authenticated role unexpectedly has direct INSERT on comic_user_block" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT public.comic_block_user('${A}'::uuid);" >/dev/null 2>&1; then
  echo "self-block unexpectedly succeeded" >&2
  exit 1
fi

UNBLOCKED="$(user_scalar "${A}" "SELECT public.comic_unblock_user('${B}'::uuid);")"
[[ "${UNBLOCKED}" == "t" ]]

A_BLOCK_COUNT_AFTER="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_list_blocked_users() WHERE blocked_user_id = '${B}'::uuid;")"
[[ "${A_BLOCK_COUNT_AFTER}" == "0" ]]

AFTER_MESSAGE_ID="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${AFTER_NONCE}'::uuid, 'after unblock');")"
[[ -n "${AFTER_MESSAGE_ID}" ]]

echo "PR-11 blocking integration checks passed."
