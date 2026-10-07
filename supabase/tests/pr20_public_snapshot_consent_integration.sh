#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="20202020-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="20202020-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="20202020-cccc-4ccc-8ccc-cccccccccccc"
UNKNOWN_REQUEST="20202020-dddd-4ddd-8ddd-dddddddddddd"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'share-a@example.test'),
  ('${B}', 'share-b@example.test'),
  ('${C}', 'share-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'sharealpha', 'share-a@example.test'),
  ('${B}', 'sharebravo', 'share-b@example.test'),
  ('${C}', 'sharecharlie', 'share-c@example.test');
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

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${AB}" ]]

M1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '20200000-0000-4000-8000-000000000001'::uuid, 'snapshot one');")"
M2="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '20200000-0000-4000-8000-000000000002'::uuid, 'snapshot two');")"
[[ -n "${M1}" && -n "${M2}" ]]

R1="$(user_scalar "${A}" "SELECT public.comic_propose_public_snapshot('${AB}'::uuid, '${M1}'::uuid);")"
[[ -n "${R1}" ]]

A_STATUS="$(user_scalar "${A}" "SELECT my_consented::text || '|' || consented_count::text || '|' || member_count::text || '|' || all_members_consented::text || '|' || sharing_eligible::text || '|' || publication_enabled::text FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${A_STATUS}" == "true|1|2|false|true|false" ]]

B_STATUS="$(user_scalar "${B}" "SELECT my_consented::text || '|' || consented_count::text || '|' || member_count::text || '|' || all_members_consented::text || '|' || sharing_eligible::text || '|' || publication_enabled::text FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${B_STATUS}" == "false|1|2|false|true|false" ]]

B_CONSENT="$(user_scalar "${B}" "SELECT public.comic_set_public_snapshot_consent('${R1}'::uuid, TRUE);")"
[[ "${B_CONSENT}" == "t" || "${B_CONSENT}" == "true" ]]

COMPLETE="$(user_scalar "${A}" "SELECT all_members_consented::text || '|' || publication_enabled::text FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${COMPLETE}" == "true|false" ]]

# New messages are outside the already-consented snapshot.
M3="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '20200000-0000-4000-8000-000000000003'::uuid, 'future message excluded');")"
SNAPSHOT_CUTOFF="$(user_scalar "${A}" "SELECT through_message_id FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${SNAPSHOT_CUTOFF}" == "${M1}" ]]
[[ "${M3}" != "${SNAPSHOT_CUTOFF}" ]]

B_REVOKE="$(user_scalar "${B}" "SELECT public.comic_set_public_snapshot_consent('${R1}'::uuid, FALSE);")"
[[ "${B_REVOKE}" == "f" || "${B_REVOKE}" == "false" ]]
AFTER_REVOKE="$(user_scalar "${A}" "SELECT consented_count::text || '|' || all_members_consented::text FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${AFTER_REVOKE}" == "1|false" ]]

# Foreign and random request IDs are indistinguishable to C.
{
  cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${C}', false);
DO \$\$
DECLARE
  foreign_error TEXT;
  unknown_error TEXT;
BEGIN
  BEGIN
    PERFORM public.comic_set_public_snapshot_consent('${R1}'::uuid, TRUE);
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM public.comic_set_public_snapshot_consent('${UNKNOWN_REQUEST}'::uuid, TRUE);
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:publication_request_forbidden' THEN
    RAISE EXCEPTION 'publication request existence oracle: % <> %',
      foreign_error, unknown_error;
  END IF;
END;
\$\$;
SQL
} | "${PSQL[@]}"

# Re-consent, then blocking permanently cancels the active proposal.
user_scalar "${B}" "SELECT public.comic_set_public_snapshot_consent('${R1}'::uuid, TRUE);" >/dev/null
user_scalar "${B}" "SELECT public.comic_block_user('${A}'::uuid);" >/dev/null

ACTIVE_AFTER_BLOCK="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_list_public_snapshot_requests('${AB}'::uuid);")"
[[ "${ACTIVE_AFTER_BLOCK}" == "0" ]]
CANCELLED_BY_BLOCK="$("${PSQL[@]}" -c "SELECT (cancelled_at IS NOT NULL)::text || '|' || cancelled_by::text FROM public.comic_publication_request WHERE id = '${R1}'::uuid;")"
[[ "${CANCELLED_BY_BLOCK}" == "true|${B}" ]]

user_scalar "${B}" "SELECT public.comic_unblock_user('${A}'::uuid);" >/dev/null
STILL_CANCELLED="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_list_public_snapshot_requests('${AB}'::uuid) WHERE request_id = '${R1}'::uuid;")"
[[ "${STILL_CANCELLED}" == "0" ]]

# A new proposal is possible after unblock, but deletion request cancels it.
R2="$(user_scalar "${A}" "SELECT public.comic_propose_public_snapshot('${AB}'::uuid, '${M2}'::uuid);")"
[[ -n "${R2}" ]]
user_scalar "${A}" "SELECT status FROM public.comic_request_account_deletion();" >/dev/null
CANCELLED_BY_DELETE="$("${PSQL[@]}" -c "SELECT (cancelled_at IS NOT NULL)::text || '|' || cancelled_by::text FROM public.comic_publication_request WHERE id = '${R2}'::uuid;")"
[[ "${CANCELLED_BY_DELETE}" == "true|${A}" ]]

user_scalar "${A}" "SELECT status FROM public.comic_cancel_account_deletion();" >/dev/null

# Either member can permanently cancel an active request.
R3="$(user_scalar "${A}" "SELECT public.comic_propose_public_snapshot('${AB}'::uuid, '${M2}'::uuid);")"
[[ -n "${R3}" && "${R3}" != "${R2}" ]]
CANCEL_RESULT="$(user_scalar "${B}" "SELECT public.comic_cancel_public_snapshot_request('${R3}'::uuid);")"
[[ "${CANCEL_RESULT}" == "t" || "${CANCEL_RESULT}" == "true" ]]

PUBLISH_FUNCTIONS="$("${PSQL[@]}" -c "
SELECT COUNT(*)
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'comic_publish%';
")"
[[ "${PUBLISH_FUNCTIONS}" == "0" ]]

if user_scalar "${A}" "INSERT INTO public.comic_publication_consent(request_id, user_id) VALUES ('${R3}'::uuid, '${A}'::uuid);" >/dev/null 2>&1; then
  echo "authenticated browser unexpectedly wrote consent table directly" >&2
  exit 1
fi

echo "PR-20 snapshot-scoped bilateral sharing consent checks passed."
