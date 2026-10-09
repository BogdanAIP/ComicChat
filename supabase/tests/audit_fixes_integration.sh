#!/usr/bin/env bash
# Isolated PostgreSQL fixture only. No provider API or email is contacted.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must target the isolated test database}"
PSQL=(psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1)
A="41414141-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="41414141-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="41414141-cccc-4ccc-8ccc-cccccccccccc"
UNKNOWN="41414141-dddd-4ddd-8ddd-dddddddddddd"
as_user(){
  { printf 'SET ROLE authenticated;\n'
    printf "SELECT pg_catalog.set_config('request.jwt.claim.sub','%s',false);\n" "$1"
    printf '%s\n' "$2"
  } | "${PSQL[@]}" | tail -n 1
}
as_service(){
  { printf 'SET ROLE service_role;\n'; printf '%s\n' "$1"; } | "${PSQL[@]}" | tail -n 1
}
deny(){
  if as_user "$1" "$2" >/dev/null 2>&1; then
    echo "AUDIT SECURITY FAILURE: $3" >&2; exit 1
  fi
}
deny_service(){
  if as_service "$1" >/dev/null 2>&1; then
    echo "AUDIT SECURITY FAILURE: $2" >&2; exit 1
  fi
}
complete_art(){
  local message="$1" claim job lease asset
  claim="$(as_service "SELECT id||'|'||lease_token||'|'||attempt_asset_id FROM public.comic_claim_generation_job_for_message('$message'::uuid,'openai-image',180);")"
  IFS='|' read -r job lease asset <<<"$claim"
  [[ -n "$job" && -n "$lease" && -n "$asset" && "$asset" != "$lease" && "$asset" != "$message" ]]
  # A foreign or previous attempt asset must never complete the current job.
  deny_service "SELECT public.comic_complete_generation_job('$job'::uuid,'$lease'::uuid,'{\"illustration\":{\"kind\":\"private-comic-art\",\"asset_id\":\"$UNKNOWN\",\"mime_type\":\"image/webp\",\"containsText\":false}}'::jsonb,1,0);" "foreign asset completed a generation"
  as_service "SELECT status FROM public.comic_complete_generation_job('$job'::uuid,'$lease'::uuid,'{\"illustration\":{\"kind\":\"private-comic-art\",\"version\":1,\"asset_id\":\"$asset\",\"mime_type\":\"image/webp\",\"containsText\":false}}'::jsonb,1,0);" >/dev/null
  deny_service "SELECT public.comic_complete_generation_job('$job'::uuid,'$lease'::uuid,'{}'::jsonb);" "stale completion overwrote artwork"
  printf '%s\n' "$asset"
}
"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id,email) VALUES
('$A','audit-a@example.test'),('$B','audit-b@example.test'),('$C','audit-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
('$A','audit-alpha','audit-a@example.test'),('$B','audit-bravo','audit-b@example.test'),
('$C','audit-charlie','audit-c@example.test')
ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email;
SQL
AB="$(as_user "$A" "SELECT public.comic_ensure_direct_conversation('$B'::uuid);")"
[[ -n "$AB" ]]

for sql in \
  "SELECT public.comic_search_users('audit');" \
  "SELECT * FROM public.comic_read_message_page('$AB'::uuid);" \
  "SELECT * FROM public.comic_claim_generation_job('mock',60);" \
  "SELECT * FROM public.comic_send_message('$AB'::uuid,gen_random_uuid(),'anon injection');"; do
  if { printf 'SET ROLE anon;\n'; printf '%s\n' "$sql"; } | "${PSQL[@]}" >/dev/null 2>&1; then
    echo 'AUDIT SECURITY FAILURE: anonymous RPC execution granted' >&2; exit 1
  fi
done

# Paid generation is enabled in SQL fixture ONLY, to exercise real-art metadata.
# There is no Edge Runtime/provider API running in this plain PostgreSQL harness.
as_service "UPDATE public.comic_generation_config SET external_generation_enabled=TRUE,provider='openai-image' WHERE singleton_id=1;" >/dev/null
M1="$(as_user "$A" "SELECT id FROM public.comic_send_message('$AB'::uuid,'41414141-1111-4111-8111-111111111111','  exact first panel  ');")"
ART="$(complete_art "$M1")"
as_service "UPDATE public.comic_generation_config SET external_generation_enabled=FALSE WHERE singleton_id=1;" >/dev/null
M2="$(as_user "$B" "SELECT id FROM public.comic_send_message('$AB'::uuid,'41414141-2222-4222-8222-222222222222','Second panel');")"
R="$(as_user "$A" "SELECT public.comic_propose_public_snapshot('$AB'::uuid,'$M2'::uuid);")"
PREVIEW="$(as_user "$B" "SELECT public.comic_read_publication_preview('$R'::uuid)::text;")"
[[ "$PREVIEW" == *"  exact first panel  "* && "$PREVIEW" == *"$ART"* ]]
deny "$C" "SELECT public.comic_read_publication_preview('$R'::uuid);" "outsider previewed private request"
deny "$C" "SELECT public.comic_read_publication_preview('$UNKNOWN'::uuid);" "unknown request accepted"
deny "$A" "SELECT * FROM public.comic_resolve_episode_asset('direct','$UNKNOWN'::uuid,0,'$A'::uuid);" "browser executed service-only asset resolver"

# Rename and add later messages, so the cutoff is outside the latest page.
"${PSQL[@]}" -c "UPDATE public.\"user\" SET username='renamed-later' WHERE id='$A'::uuid;" >/dev/null
for i in $(seq 1 10); do
  as_user "$A" "SELECT id FROM public.comic_send_message('$AB'::uuid,gen_random_uuid(),'Future panel $i');" >/dev/null
done
AFTER="$(as_user "$B" "SELECT public.comic_read_publication_preview('$R'::uuid)::text;")"
[[ "$PREVIEW" == "$AFTER" ]]
LATEST="$(as_user "$B" "SELECT STRING_AGG(id::text,',' ORDER BY created_at,id) FROM public.comic_read_message_page('$AB'::uuid,2);")"
[[ "$LATEST" != *"$M1"* && "$LATEST" != *"$M2"* ]]
as_user "$B" "SELECT public.comic_set_public_snapshot_consent('$R'::uuid,TRUE);" >/dev/null
EP="$(as_user "$A" "SELECT public.comic_release_approved_episode('$R'::uuid,'Frozen audit episode');")"
EXACT="$("${PSQL[@]}" -c "SELECT e.panels=r.panels FROM public.comic_story_episode e JOIN public.comic_publication_request r ON r.id=e.request_id WHERE e.id='$EP'::uuid;")"
[[ "$EXACT" == "t" ]]
SAFE="$(as_user "$C" "SELECT (panels::text NOT LIKE '%object_path%') AND (panels::text NOT LIKE '%$AB%') AND (panels::text NOT LIKE '%Future panel%') FROM public.comic_list_released_episodes() WHERE episode_id='$EP'::uuid;")"
[[ "$SAFE" == "t" ]]
PATH_RESULT="$(as_service "SELECT object_path FROM public.comic_resolve_episode_asset('direct','$EP'::uuid,0,'$C'::uuid);")"
[[ "$PATH_RESULT" == "$AB/$M1/$ART.webp" ]]
deny_service "SELECT * FROM public.comic_resolve_episode_asset('direct','$EP'::uuid,2,'$C'::uuid);" "unselected private panel leaked"
deny_service "SELECT * FROM public.comic_resolve_episode_asset('direct','$EP'::uuid,0,'$UNKNOWN'::uuid);" "nonexistent viewer read art"
READ_ART="$(as_user "$B" "SELECT media_asset_id FROM public.comic_read_message('$M1'::uuid);")"
[[ "$READ_ART" == "$ART" ]]
deny "$C" "SELECT * FROM public.comic_read_message('$M1'::uuid);" "public story granted private conversation access"
deny "$C" "SELECT * FROM public.comic_read_message_page('$AB'::uuid);" "foreign paginated history read"
deny "$A" "SELECT * FROM public.comic_read_message_page('$AB'::uuid,101);" "oversized page read"
deny "$A" "SELECT * FROM public.comic_read_message_page('$AB'::uuid,2,NOW(),NULL);" "partial cursor accepted"

# Force timestamp ties. Cursor pagination must neither skip nor duplicate IDs,
# and every older page carries its own frozen style rather than latest-300 data.
"${PSQL[@]}" -c "UPDATE public.comic_message SET created_at='2026-10-01 00:00:00+00' WHERE conversation_id='$AB'::uuid;" >/dev/null
{
  printf 'SET ROLE authenticated;\n'
  printf "SELECT pg_catalog.set_config('request.jwt.claim.sub','%s',false);\n" "$B"
  cat <<SQL
DO \$\$
DECLARE
  before_at TIMESTAMPTZ;
  before_id UUID;
  page_ids UUID[];
  seen UUID[] := ARRAY[]::UUID[];
  total INTEGER;
  missing_styles INTEGER;
BEGIN
  LOOP
    SELECT ARRAY_AGG(p.id ORDER BY p.created_at,p.id),
      COUNT(*) FILTER(WHERE p.style IS NULL)::INTEGER
    INTO page_ids,missing_styles
    FROM public.comic_read_message_page('$AB'::uuid,2,before_at,before_id) p;
    EXIT WHEN page_ids IS NULL;
    IF missing_styles<>0 OR seen && page_ids THEN
      RAISE EXCEPTION 'keyset duplicate or missing frozen page style';
    END IF;
    seen=seen || page_ids;
    SELECT p.created_at,p.id INTO before_at,before_id
    FROM public.comic_read_message(page_ids[1]) p;
  END LOOP;
  SELECT COUNT(*) INTO total FROM public.comic_read_conversation_messages('$AB'::uuid,100);
  IF CARDINALITY(seen)<>total OR total<>12 THEN
    RAISE EXCEPTION 'keyset omitted messages: % / %',CARDINALITY(seen),total;
  END IF;
END;
\$\$;
SQL
} | "${PSQL[@]}" >/dev/null

as_user "$B" "SELECT public.comic_set_public_snapshot_consent('$R'::uuid,FALSE);" >/dev/null
HIDDEN="$(as_user "$C" "SELECT COUNT(*) FROM public.comic_list_released_episodes() WHERE episode_id='$EP'::uuid;")"
[[ "$HIDDEN" == "0" ]]
deny_service "SELECT * FROM public.comic_resolve_episode_asset('direct','$EP'::uuid,0,'$C'::uuid);" "revoked art stayed readable"
deny "$A" "SELECT public.comic_release_approved_episode('$R'::uuid,'Again');" "revoked request allowed release"

# The same art resolver enforces closed-group current membership.
G="$(as_user "$A" "SELECT public.comic_create_group('Audit closed room','closed');")"
as_user "$A" "SELECT public.comic_invite_group_user('$G'::uuid,'$B'::uuid);" >/dev/null
as_user "$B" "SELECT public.comic_join_group('$G'::uuid,FALSE);" >/dev/null
as_service "UPDATE public.comic_generation_config SET external_generation_enabled=TRUE WHERE singleton_id=1;" >/dev/null
GM="$(as_user "$A" "SELECT id FROM public.comic_send_message('$G'::uuid,gen_random_uuid(),'Closed generated panel');")"
GA="$(complete_art "$GM")"
as_service "UPDATE public.comic_generation_config SET external_generation_enabled=FALSE WHERE singleton_id=1;" >/dev/null
GE="$(as_user "$B" "SELECT public.comic_compile_group_episode('$G'::uuid,ARRAY['$GM'::uuid],'Closed generated issue');")"
GP="$(as_service "SELECT object_path FROM public.comic_resolve_episode_asset('group','$GE'::uuid,0,'$B'::uuid);")"
[[ "$GP" == "$G/$GM/$GA.webp" ]]
deny_service "SELECT * FROM public.comic_resolve_episode_asset('group','$GE'::uuid,0,'$C'::uuid);" "closed art leaked to outsider"
as_user "$B" "SELECT public.comic_leave_group('$G'::uuid);" >/dev/null
deny_service "SELECT * FROM public.comic_resolve_episode_asset('group','$GE'::uuid,0,'$B'::uuid);" "former member retained closed art"

# Retry backoff lives on the existing job and both claim paths respect it.
JOB="$("${PSQL[@]}" -c "SELECT id FROM public.comic_generation_job WHERE message_id='$M2'::uuid;")"
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET created_at='1970-01-01 00:00:00+00',max_attempts=2 WHERE id='$JOB'::uuid;" >/dev/null
CLAIM1="$(as_service "SELECT id||'|'||lease_token||'|'||attempt_asset_id FROM public.comic_claim_generation_job_for_message('$M2'::uuid,'mock',60);")"
IFS='|' read -r J1 L1 A1 <<<"$CLAIM1"
as_service "SELECT status FROM public.comic_fail_generation_job('$J1'::uuid,'$L1'::uuid,'transient',NULL,TRUE);" >/dev/null
WAIT="$("${PSQL[@]}" -c "SELECT next_attempt_at>NOW() AND status='queued' AND attempt_count=1 FROM public.comic_generation_job WHERE id='$JOB'::uuid;")"
[[ "$WAIT" == "t" ]]
EXACT_WAIT="$(as_service "SELECT COUNT(*) FROM public.comic_claim_generation_job_for_message('$M2'::uuid,'mock',60);")"
GLOBAL_WAIT="$(as_service "SELECT COUNT(*) FROM public.comic_claim_generation_job('mock',60) WHERE message_id='$M2'::uuid;")"
[[ "$EXACT_WAIT" == 0 && "$GLOBAL_WAIT" == 0 ]]
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id='$JOB'::uuid;" >/dev/null
CLAIM2="$(as_service "SELECT id||'|'||lease_token||'|'||attempt_asset_id FROM public.comic_claim_generation_job('mock',60);")"
IFS='|' read -r J2 L2 A2 <<<"$CLAIM2"
[[ "$J2" == "$JOB" && "$L2" != "$L1" && "$A2" != "$A1" ]]
deny_service "SELECT public.comic_complete_generation_job('$JOB'::uuid,'$L1'::uuid,'{}'::jsonb);" "old attempt completed new lease"
as_service "SELECT status FROM public.comic_fail_generation_job('$JOB'::uuid,'$L2'::uuid,'terminal',NULL,TRUE);" >/dev/null
TERMINAL="$("${PSQL[@]}" -c "SELECT status||'|'||attempt_count FROM public.comic_generation_job WHERE id='$JOB'::uuid;")"
[[ "$TERMINAL" == 'failed|2' ]]
deny_service "SELECT * FROM public.comic_claim_generation_job('openai-image',180);" "disabled paid provider claimed work"

# Recover an abandoned lease through global drain, using the same persisted
# backoff and stale-attempt fence as the sender's exact-message kick.
EXPIRED_MESSAGE="$("${PSQL[@]}" -c "SELECT message_id FROM public.comic_generation_job WHERE conversation_id='$AB'::uuid AND provider='mock' AND status='queued' ORDER BY created_at,id LIMIT 1;")"
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET created_at='1969-01-01 00:00:00+00',max_attempts=2 WHERE message_id='$EXPIRED_MESSAGE'::uuid;" >/dev/null
EXPIRED_CLAIM="$(as_service "SELECT id||'|'||lease_token||'|'||attempt_asset_id FROM public.comic_claim_generation_job_for_message('$EXPIRED_MESSAGE'::uuid,'mock',60);")"
IFS='|' read -r EJ EL EA <<<"$EXPIRED_CLAIM"
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id='$EJ'::uuid;" >/dev/null
deny_service "SELECT public.comic_complete_generation_job('$EJ'::uuid,'$EL'::uuid,'{}'::jsonb);" "expired attempt completed before recovery"
as_service "SELECT COUNT(*) FROM public.comic_claim_generation_job('mock',60);" >/dev/null
EXPIRED_WAIT="$("${PSQL[@]}" -c "SELECT status='queued' AND next_attempt_at>NOW() AND lease_token IS NULL AND attempt_asset_id IS NULL AND attempt_count=1 FROM public.comic_generation_job WHERE id='$EJ'::uuid;")"
[[ "$EXPIRED_WAIT" == t ]]
EXPIRED_LEDGER="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.comic_usage_ledger WHERE job_id='$EJ'::uuid AND attempt_no=1 AND event_type IN('failed','retry_scheduled');")"
[[ "$EXPIRED_LEDGER" == 2 ]]
EXPIRED_EXACT_WAIT="$(as_service "SELECT COUNT(*) FROM public.comic_claim_generation_job_for_message('$EXPIRED_MESSAGE'::uuid,'mock',60);")"
[[ "$EXPIRED_EXACT_WAIT" == 0 ]]
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET next_attempt_at=NOW()-INTERVAL '1 second' WHERE id='$EJ'::uuid;" >/dev/null
RECOVERED="$(as_service "SELECT lease_token||'|'||attempt_asset_id FROM public.comic_claim_generation_job_for_message('$EXPIRED_MESSAGE'::uuid,'mock',60);")"
IFS='|' read -r RL RA <<<"$RECOVERED"
[[ "$RL" != "$EL" && "$RA" != "$EA" && -n "$RL" && -n "$RA" ]]
deny_service "SELECT public.comic_fail_generation_job('$EJ'::uuid,'$EL'::uuid,'late',NULL,FALSE);" "old worker failed recovered attempt"
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id='$EJ'::uuid;" >/dev/null
as_service "SELECT COUNT(*) FROM public.comic_claim_generation_job('mock',60);" >/dev/null
EXHAUSTED="$("${PSQL[@]}" -c "SELECT status='failed' AND attempt_count=2 AND lease_token IS NULL AND completed_at IS NOT NULL FROM public.comic_generation_job WHERE id='$EJ'::uuid;")"
[[ "$EXHAUSTED" == t ]]

# Timestamp defaults are absolute instants even with a non-UTC client session.
TZ_MESSAGE="$(as_user "$A" "SET TIMEZONE='Europe/Moscow'; SELECT id FROM public.comic_send_message('$G'::uuid,gen_random_uuid(),'Timezone-safe message');")"
TZ_OK="$("${PSQL[@]}" -c "SELECT NOW()-created_at BETWEEN INTERVAL '0 seconds' AND INTERVAL '5 seconds' FROM public.comic_message WHERE id='$TZ_MESSAGE'::uuid;")"
[[ "$TZ_OK" == t ]]

# A block cancels the publication preview, while historic reads stay available.
as_user "$A" "SELECT public.comic_block_user('$B'::uuid);" >/dev/null
deny "$A" "SELECT public.comic_read_publication_preview('$R'::uuid);" "cancelled preview read after block"
HISTORY="$(as_user "$B" "SELECT COUNT(*) FROM public.comic_read_message_page('$AB'::uuid);")"
[[ "$HISTORY" == 12 ]]
"${PSQL[@]}" -c "UPDATE public.comic_generation_job SET status='failed',lease_token=NULL,lease_expires_at=NULL,attempt_asset_id=NULL WHERE sender_id IN('$A'::uuid,'$B'::uuid) AND status IN('queued','rendering');" >/dev/null
echo 'Audit frozen preview, keyset, safe episode art, revocation and job backoff PASS'
