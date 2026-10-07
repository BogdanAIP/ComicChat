#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="18181818-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="18181818-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="18181818-cccc-4ccc-8ccc-cccccccccccc"
UNKNOWN_CONVERSATION="18181818-dddd-4ddd-8ddd-dddddddddddd"
UNKNOWN_MESSAGE="18181818-eeee-4eee-8eee-eeeeeeeeeeee"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'negative-a@example.test'),
  ('${B}', 'negative-b@example.test'),
  ('${C}', 'negative-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'negativealpha', 'negative-a@example.test'),
  ('${B}', 'negativebravo', 'negative-b@example.test'),
  ('${C}', 'negativecharlie', 'negative-c@example.test')
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

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
BC="$(user_scalar "${B}" "SELECT public.comic_ensure_direct_conversation('${C}'::uuid);")"
[[ -n "${AB}" && -n "${BC}" ]]

BC_MESSAGE="$(user_scalar "${C}" "SELECT id FROM public.comic_send_message('${BC}'::uuid, '18180000-0000-4000-8000-000000000001'::uuid, 'private B-C message');")"
[[ -n "${BC_MESSAGE}" ]]

# Compare foreign-existing and random-nonexistent object failures as the same caller.
{
  cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${A}', false);

DO \$\$
DECLARE
  foreign_error TEXT;
  unknown_error TEXT;
BEGIN
  BEGIN
    PERFORM * FROM public.comic_read_conversation_messages('${BC}'::uuid, 100);
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM * FROM public.comic_read_conversation_messages('${UNKNOWN_CONVERSATION}'::uuid, 100);
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:conversation_forbidden' THEN
    RAISE EXCEPTION 'read existence oracle: % <> %', foreign_error, unknown_error;
  END IF;

  BEGIN
    PERFORM public.comic_mark_conversation_read('${BC}'::uuid);
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM public.comic_mark_conversation_read('${UNKNOWN_CONVERSATION}'::uuid);
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:conversation_forbidden' THEN
    RAISE EXCEPTION 'read-receipt existence oracle: % <> %', foreign_error, unknown_error;
  END IF;

  BEGIN
    PERFORM public.comic_mark_conversation_delivered('${BC}'::uuid);
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM public.comic_mark_conversation_delivered('${UNKNOWN_CONVERSATION}'::uuid);
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:conversation_forbidden' THEN
    RAISE EXCEPTION 'delivery-receipt existence oracle: % <> %', foreign_error, unknown_error;
  END IF;

  BEGIN
    PERFORM * FROM public.comic_send_message(
      '${BC}'::uuid,
      '18180000-0000-4000-8000-000000000002'::uuid,
      'must fail'
    );
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM * FROM public.comic_send_message(
      '${UNKNOWN_CONVERSATION}'::uuid,
      '18180000-0000-4000-8000-000000000003'::uuid,
      'must fail'
    );
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:conversation_forbidden' THEN
    RAISE EXCEPTION 'send existence oracle: % <> %', foreign_error, unknown_error;
  END IF;

  BEGIN
    PERFORM * FROM public.comic_report_message(
      '${BC_MESSAGE}'::uuid,
      '18180000-0000-4000-8000-000000000004'::uuid,
      'spam',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    foreign_error := SQLSTATE || ':' || SQLERRM;
  END;
  BEGIN
    PERFORM * FROM public.comic_report_message(
      '${UNKNOWN_MESSAGE}'::uuid,
      '18180000-0000-4000-8000-000000000005'::uuid,
      'spam',
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    unknown_error := SQLSTATE || ':' || SQLERRM;
  END;
  IF foreign_error IS DISTINCT FROM unknown_error
     OR foreign_error <> '42501:report_message_forbidden' THEN
    RAISE EXCEPTION 'report-message existence oracle: % <> %', foreign_error, unknown_error;
  END IF;
END;
\$\$;
SQL
} | "${PSQL[@]}"

# Confirm self-only RPCs cannot be parameterized into another user's data.
A_EXPORT_USER="$(user_scalar "${A}" "SELECT comic_export_my_data()->'profile'->>'id';")"
A_STATE="$(user_scalar "${A}" "SELECT status FROM public.comic_get_my_account_state();")"
[[ "${A_EXPORT_USER}" == "${A}" ]]
[[ "${A_STATE}" == "active" ]]

REALTIME_DENY_POLICY="$("${PSQL[@]}" -c "
SELECT COUNT(*)
FROM pg_policies
WHERE schemaname = 'realtime'
  AND tablename = 'messages'
  AND policyname = 'comicchat_deny_client_realtime_insert'
  AND cmd = 'INSERT'
  AND permissive = 'RESTRICTIVE'
  AND roles @> ARRAY['authenticated']::NAME[]
  AND roles @> ARRAY['anon']::NAME[]
  AND COALESCE(with_check, '') ~* 'false';
")"
[[ "${REALTIME_DENY_POLICY}" == "1" ]]

echo "PR-18 PostgreSQL negative-security matrix passed."
