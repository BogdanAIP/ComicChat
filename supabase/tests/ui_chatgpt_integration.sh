#!/usr/bin/env bash
# Isolated CI database only: no image API, Storage or external network calls.
set -euo pipefail
: "${DATABASE_URL:?isolated test database required}"
PSQL=(psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1)
A=43434343-aaaa-4aaa-8aaa-aaaaaaaaaaaa
B=43434343-bbbb-4bbb-8bbb-bbbbbbbbbbbb
C=43434343-cccc-4ccc-8ccc-cccccccccccc
ART1=43434343-1111-4111-8111-111111111111
ART2=43434343-2222-4222-8222-222222222222
as_user(){
  { printf 'SET ROLE authenticated;\n'
    printf "SELECT set_config('request.jwt.claim.sub','%s',false);\n" "$1"
    printf '%s\n' "$2"
  } | "${PSQL[@]}" | tail -n 1
}
as_service(){
  { printf 'SET ROLE service_role;\n'; printf '%s\n' "$1"; } | "${PSQL[@]}" | tail -n 1
}
deny(){
  if as_user "$1" "$2" >/dev/null 2>&1; then
    echo "UI SECURITY FAILURE: $3" >&2; exit 1
  fi
}
deny_service(){
  if as_service "$1" >/dev/null 2>&1; then
    echo "UI SECURITY FAILURE: $2" >&2; exit 1
  fi
}
"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id,email) VALUES
('$A','ui-a@example.test'),('$B','ui-b@example.test'),('$C','ui-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
('$A','ui-alpha','ui-a@example.test'),('$B','ui-bravo','ui-b@example.test'),
('$C','ui-charlie','ui-c@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username;
SQL
[[ "$(as_user "$A" "SELECT locale||'|'||theme FROM public.comic_get_my_preferences();")" == "ru|classic" ]]
as_user "$A" "SELECT * FROM public.comic_set_my_preferences('ar','manga');" >/dev/null
[[ "$(as_user "$A" "SELECT locale||'|'||theme FROM public.comic_get_my_preferences();")" == "ar|manga" ]]
[[ "$(as_user "$B" "SELECT locale||'|'||theme FROM public.comic_get_my_preferences();")" == "ru|classic" ]]
deny "$A" "SELECT * FROM public.comic_set_my_preferences('xx','manga');" "invalid locale accepted"
deny "$A" "SELECT * FROM public.comic_set_my_preferences('ru','custom');" "invalid theme accepted"
deny "$B" "SELECT * FROM public.comic_ui_preferences;" "direct preferences access"
for sql in "SELECT * FROM public.comic_get_my_preferences();" "SELECT * FROM public.comic_set_my_preferences('en','anime');"; do
  if { printf 'SET ROLE anon;\n'; printf '%s\n' "$sql"; } | "${PSQL[@]}" >/dev/null 2>&1; then
    echo 'UI SECURITY FAILURE: anonymous preferences access' >&2; exit 1
  fi
done
AB="$(as_user "$A" "SELECT public.comic_ensure_direct_conversation('$B'::uuid);")"
M="$(as_user "$A" "SELECT id FROM public.comic_send_message('$AB'::uuid,gen_random_uuid(),E'  original\nПривет!  ');")"
[[ -n "$AB" && -n "$M" ]]
COMMIT="SELECT public.comic_commit_chatgpt_art('$A'::uuid,'$M'::uuid,'$ART1'::uuid,'image/png');"
deny "$A" "$COMMIT" "browser executed trusted attachment commit"
deny_service "SELECT public.comic_commit_chatgpt_art('$B'::uuid,'$M'::uuid,'$ART1'::uuid,'image/png');" "recipient attached sender artwork"
deny_service "SELECT public.comic_commit_chatgpt_art('$C'::uuid,'$M'::uuid,'$ART1'::uuid,'image/png');" "outsider attached artwork"
deny_service "SELECT public.comic_commit_chatgpt_art('$A'::uuid,'$M'::uuid,'$ART1'::uuid,'image/svg+xml');" "unsupported image MIME accepted"
as_service "$COMMIT" >/dev/null
[[ "$(as_user "$B" "SELECT media_asset_id FROM public.comic_read_message('$M'::uuid);")" == "$ART1" ]]
[[ "$(as_user "$B" "SELECT original_text=E'  original\nПривет!  ' FROM public.comic_read_message('$M'::uuid);")" == "t" ]]
deny "$C" "SELECT * FROM public.comic_read_message('$M'::uuid);" "outsider read private illustration"
[[ "$("${PSQL[@]}" -c "SELECT provider||'|'||billing_source||'|'||status FROM public.comic_generation_job WHERE message_id='$M';")" == "chatgpt-user-art|chatgpt-user-provided|ready" ]]
[[ "$("${PSQL[@]}" -c "SELECT lease_token IS NULL AND attempt_asset_id IS NULL AND lease_expires_at IS NULL FROM public.comic_generation_job WHERE message_id='$M';")" == "t" ]]
[[ "$("${PSQL[@]}" -c "SELECT public.comic_frozen_panel_metadata('$M')->'illustration'->>'mime_type';")" == "image/png" ]]
# Existing publication snapshots keep their original art ID on later attachment.
R="$(as_user "$A" "SELECT public.comic_propose_public_snapshot('$AB'::uuid,'$M'::uuid);")"
BEFORE="$(as_user "$B" "SELECT public.comic_read_publication_preview('$R'::uuid)::text;")"
[[ "$BEFORE" == *"$ART1"* ]]
as_service "SELECT public.comic_commit_chatgpt_art('$A'::uuid,'$M'::uuid,'$ART2'::uuid,'image/jpeg');" >/dev/null
[[ "$(as_user "$B" "SELECT media_asset_id FROM public.comic_read_message('$M'::uuid);")" == "$ART2" ]]
[[ "$(as_user "$B" "SELECT public.comic_read_publication_preview('$R'::uuid)::text;")" == "$BEFORE" ]]
G="$(as_user "$A" "SELECT public.comic_create_group('UI test closed room','closed');")"
GM="$(as_user "$A" "SELECT id FROM public.comic_send_message('$G'::uuid,gen_random_uuid(),'group');")"
deny_service "SELECT public.comic_commit_chatgpt_art('$A'::uuid,'$GM'::uuid,'$ART1'::uuid,'image/png');" "DM attachment handler accepted group message"
[[ "$(as_service "SELECT external_generation_enabled FROM public.comic_generation_config WHERE singleton_id=1;")" == "f" ]]
echo 'Account-scoped preferences, sender-only art, original text and frozen snapshots: PASS'
