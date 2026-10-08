#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL required}"
PSQL=(psql "${DATABASE_URL}" -qAt -v ON_ERROR_STOP=1)
A="36363636-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="36363636-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="36363636-cccc-4ccc-8ccc-cccccccccccc"
"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id,email) VALUES
 ('${A}','group-a@example.test'),('${B}','group-b@example.test'),
 ('${C}','group-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
 ('${A}','groupalpha','group-a@example.test'),
 ('${B}','groupbravo','group-b@example.test'),
 ('${C}','groupcharlie','group-c@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email;
SQL
run_as() {
  local who="$1" statement="$2"
  {
    cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','${who}',false);
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}
must_deny() {
  local who="$1" statement="$2" why="$3"
  if run_as "$who" "$statement" >/dev/null 2>&1; then
    echo "GROUP SECURITY FAILED: $why" >&2
    exit 1
  fi
}

CLOSED="$(run_as "${A}" "SELECT public.comic_create_group('Our secret adventures','closed');")"
[[ -n "${CLOSED}" ]]
must_deny "${C}" "SELECT public.comic_join_group('${CLOSED}'::uuid,FALSE);" "uninvited stranger joined closed group"
must_deny "${C}" "SELECT public.comic_read_conversation_messages('${CLOSED}'::uuid,100);" "uninvited stranger read closed group"
INVITE="$(run_as "${A}" "SELECT public.comic_invite_group_user('${CLOSED}'::uuid,'${B}'::uuid);")"
[[ "${INVITE}" = "t" || "${INVITE}" = "true" ]]
PENDING="$(run_as "${B}" "SELECT COUNT(*) FROM public.comic_list_group_invitations() WHERE conversation_id='${CLOSED}'::uuid;")"
[[ "${PENDING}" = "1" ]]
must_deny "${C}" "SELECT public.comic_invite_group_user('${CLOSED}'::uuid,'${B}'::uuid);" "outsider sent group invitation"
JOINED="$(run_as "${B}" "SELECT public.comic_join_group('${CLOSED}'::uuid,FALSE);")"
[[ "${JOINED}" = "${CLOSED}" ]]
MEMBERS="$(run_as "${B}" "SELECT member_count FROM public.comic_list_groups() WHERE conversation_id='${CLOSED}'::uuid;")"
[[ "${MEMBERS}" = "2" ]]
M1="$(run_as "${B}" "SELECT id FROM public.comic_send_message('${CLOSED}'::uuid,'36363636-1111-4111-8111-111111111111'::uuid,'Comic panel from Bravo');")"
[[ -n "${M1}" ]]
M2="$(run_as "${A}" "SELECT id FROM public.comic_send_message('${CLOSED}'::uuid,'36363636-2222-4222-8222-222222222222'::uuid,'Comic panel from Alpha');")"
[[ -n "${M2}" ]]
READ="$(run_as "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${CLOSED}'::uuid,100);")"
[[ "${READ}" = "2" ]]
must_deny "${C}" "SELECT public.comic_send_message('${CLOSED}'::uuid,gen_random_uuid(),'Intrusion');" "outsider sent group message"
must_deny "${C}" "SELECT COUNT(*) FROM public.comic_list_group_members('${CLOSED}'::uuid);" "outsider learned group members"
REMAINING="$(run_as "${A}" "SELECT member_count FROM public.comic_list_groups() WHERE conversation_id='${CLOSED}'::uuid;")"
if [[ "${REMAINING}" == "2" ]]; then
  LEFT="$(run_as "${B}" "SELECT public.comic_leave_group('${CLOSED}'::uuid);")"
  [[ "${LEFT}" = "t" || "${LEFT}" = "true" ]]
fi
must_deny "${B}" "SELECT public.comic_read_conversation_messages('${CLOSED}'::uuid,100);" "former member read group"
must_deny "${A}" "SELECT public.comic_leave_group('${CLOSED}'::uuid);" "owner abandoned group without transfer"

PUBLIC="$(run_as "${A}" "SELECT public.comic_create_group('Public comic discussion','public');")"
[[ -n "${PUBLIC}" ]]
must_deny "${B}" "SELECT public.comic_join_group('${PUBLIC}'::uuid,FALSE);" "joined public group without terms"
JOIN_PUBLIC="$(run_as "${B}" "SELECT public.comic_join_group('${PUBLIC}'::uuid,TRUE);")"
[[ "${JOIN_PUBLIC}" = "${PUBLIC}" ]]
run_as "${C}" "SELECT public.comic_join_group('${PUBLIC}'::uuid,TRUE);" >/dev/null
ACCEPTED="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_group_terms_acceptance WHERE conversation_id='${PUBLIC}'::uuid;")"
[[ "${ACCEPTED}" = "3" ]]
M3="$(run_as "${C}" "SELECT id FROM public.comic_send_message('${PUBLIC}'::uuid,'36363636-3333-4333-8333-333333333333'::uuid,'Shared public group panel');")"
[[ -n "${M3}" ]]
GROUP_READ="$(run_as "${B}" "SELECT original_text FROM public.comic_read_conversation_messages('${PUBLIC}'::uuid,100);")"
[[ "${GROUP_READ}" = "Shared public group panel" ]]
if run_as "${B}" "INSERT INTO public.comic_membership(conversation_id,user_id) VALUES('${CLOSED}'::uuid,'${B}'::uuid);" >/dev/null 2>&1; then
  echo "GROUP SECURITY FAILED: direct membership write" >&2; exit 1
fi
if run_as "${B}" "INSERT INTO public.comic_group_profile(conversation_id,title,visibility) VALUES(gen_random_uuid(),'Unsafe group','public');" >/dev/null 2>&1; then
  echo "GROUP SECURITY FAILED: direct metadata write" >&2; exit 1
fi
echo "PR-36 secure group chat, live messages and explicit join consent passed."
