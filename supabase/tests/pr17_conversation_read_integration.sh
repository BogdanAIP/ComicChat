#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="17171717-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="17171717-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="17171717-cccc-4ccc-8ccc-cccccccccccc"
UNKNOWN="17171717-dddd-4ddd-8ddd-dddddddddddd"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'read-a@example.test'),
  ('${B}', 'read-b@example.test'),
  ('${C}', 'read-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'readalpha', 'read-a@example.test'),
  ('${B}', 'readbravo', 'read-b@example.test'),
  ('${C}', 'readcharlie', 'read-c@example.test')
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

A1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '17170000-0000-4000-8000-000000000001'::uuid, 'first visible message');")"
B1="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '17170000-0000-4000-8000-000000000002'::uuid, 'second visible message');")"
C1="$(user_scalar "${C}" "SELECT id FROM public.comic_send_message('${BC}'::uuid, '17170000-0000-4000-8000-000000000003'::uuid, 'foreign hidden message');")"
[[ -n "${A1}" && -n "${B1}" && -n "${C1}" ]]

A_COUNT="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${AB}'::uuid, 100);")"
B_COUNT="$(user_scalar "${B}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${AB}'::uuid, 100);")"
[[ "${A_COUNT}" == "2" ]]
[[ "${B_COUNT}" == "2" ]]

ORDERED="$(user_scalar "${A}" "SELECT string_agg(original_text, '|' ORDER BY created_at, id) FROM public.comic_read_conversation_messages('${AB}'::uuid, 100);")"
[[ "${ORDERED}" == "first visible message|second visible message" ]]

LIMITED="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${AB}'::uuid, 1);")"
[[ "${LIMITED}" == "1" ]]

if user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${BC}'::uuid, 100);" >/dev/null 2>&1; then
  echo "foreign conversation read unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${C}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${AB}'::uuid, 100);" >/dev/null 2>&1; then
  echo "non-member conversation read unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${UNKNOWN}'::uuid, 100);" >/dev/null 2>&1; then
  echo "unknown conversation read unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "SELECT COUNT(*) FROM public.comic_read_conversation_messages('${AB}'::uuid, 1001);" >/dev/null 2>&1; then
  echo "oversized message read unexpectedly succeeded" >&2
  exit 1
fi

{
  cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${A}', false);

DO \$\$
DECLARE
    foreign_error TEXT := NULL;
    unknown_error TEXT := NULL;
BEGIN
    BEGIN
        PERFORM *
        FROM public.comic_read_conversation_messages('${BC}'::uuid, 100);
    EXCEPTION WHEN OTHERS THEN
        foreign_error := SQLSTATE || ':' || SQLERRM;
    END;

    BEGIN
        PERFORM *
        FROM public.comic_read_conversation_messages('${UNKNOWN}'::uuid, 100);
    EXCEPTION WHEN OTHERS THEN
        unknown_error := SQLSTATE || ':' || SQLERRM;
    END;

    IF foreign_error IS NULL OR unknown_error IS NULL THEN
        RAISE EXCEPTION 'expected both forbidden read paths to fail';
    END IF;

    IF foreign_error IS DISTINCT FROM unknown_error THEN
        RAISE EXCEPTION 'conversation existence oracle detected: % <> %',
            foreign_error, unknown_error;
    END IF;

    IF foreign_error <> '42501:conversation_forbidden' THEN
        RAISE EXCEPTION 'unexpected forbidden read contract: %', foreign_error;
    END IF;
END;
\$\$;
SQL
} | "${PSQL[@]}"

echo "PR-17 explicit conversation-read IDOR checks passed."
