#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="11111111-1111-4111-8111-111111111111"
B="22222222-2222-4222-8222-222222222222"
C="33333333-3333-4333-8333-333333333333"
NONCE="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OTHER_NONCE="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'a@example.test'),
  ('${B}', 'b@example.test'),
  ('${C}', 'c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'alpha', 'a@example.test'),
  ('${B}', 'bravo', 'b@example.test'),
  ('${C}', 'charlie', 'c@example.test');
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

B_CONVERSATION_ID="$(user_scalar "${B}" "SELECT public.comic_ensure_direct_conversation('${A}'::uuid);")"
[[ "${CONVERSATION_ID}" == "${B_CONVERSATION_ID}" ]]

B_OWN_MEMBERSHIP="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_membership WHERE conversation_id = '${CONVERSATION_ID}'::uuid;")"
[[ "${B_OWN_MEMBERSHIP}" == "1" ]]

C_MEMBERSHIP_VISIBILITY="$(user_scalar "${C}" "SELECT COUNT(*) FROM public.comic_membership WHERE conversation_id = '${CONVERSATION_ID}'::uuid;")"
[[ "${C_MEMBERSHIP_VISIBILITY}" == "0" ]]

MESSAGE_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE}'::uuid, 'hello bravo');")"
[[ -n "${MESSAGE_ID}" ]]

DUPLICATE_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE}'::uuid, 'hello bravo');")"
[[ "${MESSAGE_ID}" == "${DUPLICATE_ID}" ]]

if user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${NONCE}'::uuid, 'changed text');" >/dev/null 2>&1; then
  echo "expected client_nonce conflict was accepted" >&2
  exit 1
fi

VISIBLE_TO_B="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_message WHERE id = '${MESSAGE_ID}'::uuid;")"
[[ "${VISIBLE_TO_B}" == "1" ]]

VISIBLE_TO_C="$(user_scalar "${C}" "SELECT COUNT(*) FROM public.comic_message WHERE id = '${MESSAGE_ID}'::uuid;")"
[[ "${VISIBLE_TO_C}" == "0" ]]

LISTED_FOR_B="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_list_direct_conversations() WHERE conversation_id = '${CONVERSATION_ID}'::uuid;")"
[[ "${LISTED_FOR_B}" == "1" ]]

WILDCARD_ENUMERATION="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_search_users('%_');")"
[[ "${WILDCARD_ENUMERATION}" == "0" ]]

if user_scalar "${C}" "SELECT id FROM public.comic_send_message('${CONVERSATION_ID}'::uuid, '${OTHER_NONCE}'::uuid, 'intrusion');" >/dev/null 2>&1; then
  echo "non-member was able to send into a private conversation" >&2
  exit 1
fi

if user_scalar "${A}" "INSERT INTO public.comic_message(conversation_id, sender_id, client_nonce, original_text) VALUES ('${CONVERSATION_ID}'::uuid, '${A}'::uuid, '${OTHER_NONCE}'::uuid, 'direct insert') RETURNING id;" >/dev/null 2>&1; then
  echo "authenticated role unexpectedly has direct INSERT on comic_message" >&2
  exit 1
fi

user_scalar "${B}" "SELECT public.comic_mark_conversation_delivered('${CONVERSATION_ID}'::uuid);" >/dev/null
user_scalar "${B}" "SELECT public.comic_mark_conversation_read('${CONVERSATION_ID}'::uuid);" >/dev/null

B_RECEIPT_OK="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message_receipt WHERE message_id = '${MESSAGE_ID}'::uuid AND user_id = '${B}'::uuid AND delivered_at IS NOT NULL AND read_at IS NOT NULL;")"
[[ "${B_RECEIPT_OK}" == "1" ]]

A_RECEIPT_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_message_receipt WHERE message_id = '${MESSAGE_ID}'::uuid AND user_id = '${A}'::uuid;")"
[[ "${A_RECEIPT_COUNT}" == "0" ]]

if user_scalar "${C}" "SELECT public.comic_mark_conversation_read('${CONVERSATION_ID}'::uuid);" >/dev/null 2>&1; then
  echo "non-member was able to mutate conversation receipts" >&2
  exit 1
fi

echo "PR-02 PostgreSQL two-user integration checks passed."
