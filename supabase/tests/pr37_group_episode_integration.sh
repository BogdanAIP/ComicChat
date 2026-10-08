#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt)
A="37373737-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="37373737-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="37373737-cccc-4ccc-8ccc-cccccccccccc"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id,email) VALUES
 ('${A}','episode-group-a@example.test'),
 ('${B}','episode-group-b@example.test'),
 ('${C}','episode-group-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
 ('${A}','episodegroupalpha','episode-group-a@example.test'),
 ('${B}','episodegroupbravo','episode-group-b@example.test'),
 ('${C}','episodegroupcharlie','episode-group-c@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email;
SQL

run_as(){
 local who="$1" sql="$2"
 { printf 'SET ROLE authenticated;\n'
   printf "SELECT pg_catalog.set_config('request.jwt.claim.sub','%s',false);\n" "$who"
   printf '%s\n' "$sql"
 } | "${PSQL[@]}" | tail -n 1
}
deny(){
 local who="$1" sql="$2" label="$3"
 if run_as "$who" "$sql" >/dev/null 2>&1; then
   echo "PR37 SECURITY FAILURE: $label" >&2; exit 1
 fi
}

CLOSED="$(run_as "$A" "SELECT public.comic_create_group('Closed story room','closed');")"
run_as "$A" "SELECT public.comic_invite_group_user('$CLOSED'::uuid,'$B'::uuid);" >/dev/null
run_as "$B" "SELECT public.comic_join_group('$CLOSED'::uuid,FALSE);" >/dev/null
X="$(run_as "$A" "SELECT id FROM public.comic_send_message('$CLOSED'::uuid,'37373737-1111-4111-8111-111111111111','Closed comic panel from A');")"
Y="$(run_as "$B" "SELECT id FROM public.comic_send_message('$CLOSED'::uuid,'37373737-2222-4222-8222-222222222222','Closed comic panel from B');")"
[[ -n "$X" && -n "$Y" ]]

deny "$C" "SELECT public.comic_compile_group_episode('$CLOSED'::uuid,ARRAY['$X'::uuid], 'Stolen');" "outsider compiled closed episode"
deny "$A" "SELECT public.comic_compile_group_episode('$CLOSED'::uuid,ARRAY['$X'::uuid,'$X'::uuid], 'Dup');" "duplicate source panels accepted"
deny "$A" "SELECT public.comic_compile_group_episode('$CLOSED'::uuid,ARRAY[]::uuid[], 'Empty');" "empty source accepted"
STORY="$(run_as "$B" "SELECT public.comic_compile_group_episode('$CLOSED'::uuid,ARRAY['$Y'::uuid,'$X'::uuid], 'Closed issue');")"
[[ -n "$STORY" ]]
SCOPE="$(run_as "$A" "SELECT visibility||'|'||JSONB_ARRAY_LENGTH(panels)||'|'||panels->0->>'text'||'|'||panels->1->>'text' FROM public.comic_list_group_episodes('$CLOSED'::uuid) WHERE episode_id='$STORY'::uuid;")"
[[ "$SCOPE" == "group|2|Closed comic panel from A|Closed comic panel from B" ]]
deny "$C" "SELECT count(*) FROM public.comic_list_group_episodes('$CLOSED'::uuid);" "outsider read closed episode"
deny "$B" "SELECT public.comic_publish_group_episode('$STORY'::uuid);" "closed episode published by its author"
deny "$A" "SELECT public.comic_publish_group_episode('$STORY'::uuid);" "closed episode published by a nonauthor"
PUBLIC_COUNT="$(run_as "$C" "SELECT COUNT(*) FROM public.comic_list_public_group_episodes(30) WHERE episode_id='$STORY'::uuid;")"
[[ "$PUBLIC_COUNT" == 0 ]]
deny "$C" "SELECT COUNT(*) FROM public.comic_group_episode;" "direct episode table read"

PUBLIC="$(run_as "$A" "SELECT public.comic_create_group('Public group story room','public');")"
deny "$B" "SELECT public.comic_join_group('$PUBLIC'::uuid,FALSE);" "entered public group without public terms"
run_as "$B" "SELECT public.comic_join_group('$PUBLIC'::uuid,TRUE);" >/dev/null
run_as "$C" "SELECT public.comic_join_group('$PUBLIC'::uuid,TRUE);" >/dev/null
P1="$(run_as "$B" "SELECT id FROM public.comic_send_message('$PUBLIC'::uuid,'37373737-3333-4333-8333-333333333333','Public comic panel from B');")"
P2="$(run_as "$C" "SELECT id FROM public.comic_send_message('$PUBLIC'::uuid,'37373737-4444-4444-8444-444444444444','Public comic panel from C');")"
[[ -n "$P1" && -n "$P2" ]]
deny "$A" "SELECT public.comic_compile_group_episode('$PUBLIC'::uuid,ARRAY['$X'::uuid,'$P1'::uuid], 'Leak');" "foreign closed message was mixed into public story"
PUB_STORY="$(run_as "$B" "SELECT public.comic_compile_group_episode('$PUBLIC'::uuid,ARRAY['$P1'::uuid,'$P2'::uuid], 'Public issue');")"
[[ -n "$PUB_STORY" ]]

# A participant may compile a public group story; only its author can release it.
deny "$A" "SELECT public.comic_publish_group_episode('$PUB_STORY'::uuid);" "other member released episode"
BEFORE="$(run_as "$A" "SELECT COUNT(*) FROM public.comic_list_public_group_episodes() WHERE episode_id='$PUB_STORY'::uuid;")"
[[ "$BEFORE" == 0 ]]
# Tampering with an accepted_at timestamp into the future must disallow publication.
"${PSQL[@]}" -c "UPDATE public.comic_group_terms_acceptance SET accepted_at=NOW()+INTERVAL '10 minutes' WHERE conversation_id='$PUBLIC'::uuid AND user_id='$C'::uuid;" >/dev/null
deny "$B" "SELECT public.comic_publish_group_episode('$PUB_STORY'::uuid);" "publisher ignored missing consent at message time"
"${PSQL[@]}" -c "UPDATE public.comic_group_terms_acceptance SET accepted_at=NOW()-INTERVAL '10 minutes' WHERE conversation_id='$PUBLIC'::uuid AND user_id='$C'::uuid;" >/dev/null
APPROVED="$(run_as "$B" "SELECT public.comic_publish_group_episode('$PUB_STORY'::uuid);")"
[[ "$APPROVED" == "t" || "$APPROVED" == "true" ]]
FEED="$(run_as "$A" "SELECT COUNT(*)||'|'||(panels::text LIKE '%Public comic panel from C%')::text FROM public.comic_list_public_group_episodes() WHERE episode_id='$PUB_STORY'::uuid GROUP BY panels;")"
[[ "$FEED" == "1|true" ]]
RETRY="$(run_as "$B" "SELECT public.comic_publish_group_episode('$PUB_STORY'::uuid);")"
[[ "$RETRY" == "t" || "$RETRY" == "true" ]]

# Revoke membership -> no more reads. Ex-members' published contributions
# fail closed in the public feed until an explicit future policy is designed.
run_as "$C" "SELECT public.comic_leave_group('$PUBLIC'::uuid);" >/dev/null
MISSING="$(run_as "$A" "SELECT COUNT(*) FROM public.comic_list_public_group_episodes() WHERE episode_id='$PUB_STORY'::uuid;")"
[[ "$MISSING" == 0 ]]
deny "$C" "SELECT COUNT(*) FROM public.comic_list_group_episodes('$PUBLIC'::uuid);" "former member sees group-only episodes"

echo 'PR-37 group episode privacy, exact source selection, publishing terms and revocation PASS'
