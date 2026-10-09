#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
PSQL=(psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1)
A="38383838-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="38383838-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="38383838-cccc-4ccc-8ccc-cccccccccccc"
"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id,email) VALUES
('$A','styles-a@example.test'),('$B','styles-b@example.test'),('$C','styles-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
('$A','stylesalpha','styles-a@example.test'),
('$B','stylesbravo','styles-b@example.test'),
('$C','stylescharlie','styles-c@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email;
SQL
as_user(){
 local uid="$1" query="$2"
 {
   printf "SET ROLE authenticated;\n"
   printf "SELECT pg_catalog.set_config('request.jwt.claim.sub','%s',false);\n" "$uid"
   printf '%s\n' "$query"
 } | "${PSQL[@]}" | tail -n 1
}
deny(){
 if as_user "$1" "$2" >/dev/null 2>&1; then
   echo "PR38 SECURITY FAILURE: $3" >&2; exit 1
 fi
}
D="$(as_user "$A" "SELECT public.comic_ensure_direct_conversation('$B'::uuid);")"
[[ -n "$D" ]]
START="$(as_user "$A" "SELECT primary_style_id||'|'||COALESCE(secondary_style_id,'NONE')||'|'||secondary_weight FROM public.comic_get_conversation_style('$D'::uuid);")"
[[ "$START" == "anime|NONE|0" ]]
deny "$C" "SELECT * FROM public.comic_get_conversation_style('$D'::uuid);" "stranger read direct style"
deny "$C" "SELECT public.comic_set_conversation_style('$D'::uuid,'manga',NULL,0);" "stranger changed direct style"
deny "$A" "SELECT public.comic_set_conversation_style('$D'::uuid,'realism',NULL,0);" "realism preset accepted"
deny "$A" "SELECT public.comic_set_conversation_style('$D'::uuid,'manga','manga',30);" "duplicate mix accepted"
deny "$A" "SELECT public.comic_set_conversation_style('$D'::uuid,'manga','anime',105);" "out-of-range weight accepted"
MSG1="$(as_user "$A" "SELECT id FROM public.comic_send_message('$D'::uuid,'38383838-1111-4111-8111-111111111111','First anime panel');")"
[[ -n "$MSG1" ]]
as_user "$B" "SELECT public.comic_set_conversation_style('$D'::uuid,'manga','anime',30);" >/dev/null
MSG2="$(as_user "$B" "SELECT id FROM public.comic_send_message('$D'::uuid,'38383838-2222-4222-8222-222222222222','Mixed manga and anime panel');")"
as_user "$A" "SELECT public.comic_set_conversation_style('$D'::uuid,'superhero',NULL,0);" >/dev/null
MSG3="$(as_user "$A" "SELECT id FROM public.comic_send_message('$D'::uuid,'38383838-3333-4333-8333-333333333333','Superhero panel');")"
[[ -n "$MSG2" && -n "$MSG3" ]]
HISTORY="$(as_user "$B" "SELECT STRING_AGG(primary_style_id||':'||COALESCE(secondary_style_id,'NONE')||':'||secondary_weight,',' ORDER BY message_id::text) FROM public.comic_list_message_styles('$D'::uuid);")"
[[ "$HISTORY" == *"anime:NONE:0"* && "$HISTORY" == *"manga:anime:30"* && "$HISTORY" == *"superhero:NONE:0"* ]]
deny "$C" "SELECT * FROM public.comic_list_message_styles('$D'::uuid);" "stranger read member snapshots"
deny "$A" "UPDATE public.comic_message_style SET primary_style_id='manga' WHERE message_id='$MSG1'::uuid;" "client changed frozen message style"
deny "$B" "SELECT count(*) FROM public.comic_conversation_style;" "client read private style table directly"
deny "$B" "SELECT count(*) FROM public.comic_message_style;" "client read private message style table directly"

G="$(as_user "$A" "SELECT public.comic_create_group('Style group comic','closed');")"
as_user "$A" "SELECT public.comic_invite_group_user('$G'::uuid,'$B'::uuid);" >/dev/null
as_user "$B" "SELECT public.comic_join_group('$G'::uuid,FALSE);" >/dev/null
deny "$B" "SELECT public.comic_set_conversation_style('$G'::uuid,'cartoon',NULL,0);" "nonowner changed group style"
as_user "$A" "SELECT public.comic_set_conversation_style('$G'::uuid,'cartoon','romance',40);" >/dev/null
MSG4="$(as_user "$B" "SELECT id FROM public.comic_send_message('$G'::uuid,'38383838-4444-4444-8444-444444444444','Group cartoon romance panel');")"
[[ -n "$MSG4" ]]
GR="$(as_user "$B" "SELECT primary_style_id||'+'||secondary_style_id||':'||secondary_weight FROM public.comic_list_message_styles('$G'::uuid) WHERE message_id='$MSG4'::uuid;")"
[[ "$GR" == "cartoon+romance:40" ]]
deny "$C" "SELECT * FROM public.comic_get_conversation_style('$G'::uuid);" "outsider read closed group style"
as_user "$B" "SELECT public.comic_leave_group('$G'::uuid);" >/dev/null
deny "$B" "SELECT * FROM public.comic_list_message_styles('$G'::uuid);" "exmember read group styles"

echo "PR38 Style Skill permissions, frozen renders, owner-only group settings and no realism PASS"
