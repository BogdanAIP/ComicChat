#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="15151515-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="15151515-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="15151515-cccc-4ccc-8ccc-cccccccccccc"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'export-a@example.test'),
  ('${B}', 'export-b@example.test'),
  ('${C}', 'export-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'exportalpha', 'export-a@example.test'),
  ('${B}', 'exportbravo', 'export-b@example.test'),
  ('${C}', 'exportcharlie', 'export-c@example.test')
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

AB_CONVERSATION="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
BC_CONVERSATION="$(user_scalar "${B}" "SELECT public.comic_ensure_direct_conversation('${C}'::uuid);")"
[[ -n "${AB_CONVERSATION}" && -n "${BC_CONVERSATION}" ]]

A_MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '15150000-0000-4000-8000-000000000001'::uuid, 'alpha export message');")"
B_MESSAGE="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB_CONVERSATION}'::uuid, '15150000-0000-4000-8000-000000000002'::uuid, 'bravo visible history');")"
C_MESSAGE="$(user_scalar "${C}" "SELECT id FROM public.comic_send_message('${BC_CONVERSATION}'::uuid, '15150000-0000-4000-8000-000000000003'::uuid, 'charlie must not leak');")"

[[ -n "${A_MESSAGE}" && -n "${B_MESSAGE}" && -n "${C_MESSAGE}" ]]

user_scalar "${A}" "SELECT public.comic_block_user('${C}'::uuid);" >/dev/null
REPORT_ID="$(user_scalar "${A}" "SELECT id FROM public.comic_report_message('${B_MESSAGE}'::uuid, '15150000-0000-4000-8000-000000000004'::uuid, 'spam', 'exported reporter-owned detail');")"
[[ -n "${REPORT_ID}" ]]

{
  cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${A}', false);

DO \$\$
DECLARE
    exported JSONB := public.comic_export_my_data();
BEGIN
    IF exported->>'schema_version' <> '1' THEN
        RAISE EXCEPTION 'unexpected export schema version';
    END IF;

    IF exported #>> '{profile,id}' <> '${A}' THEN
        RAISE EXCEPTION 'export profile is not caller scoped';
    END IF;

    IF exported #>> '{profile,email}' <> 'export-a@example.test' THEN
        RAISE EXCEPTION 'caller profile email missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'conversations') AS item
        WHERE item->>'id' = '${AB_CONVERSATION}'
    ) THEN
        RAISE EXCEPTION 'authorized conversation missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'conversations') AS item
        WHERE item->>'id' = '${BC_CONVERSATION}'
    ) THEN
        RAISE EXCEPTION 'unrelated conversation leaked';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'messages') AS item
        WHERE item->>'id' = '${A_MESSAGE}'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'messages') AS item
        WHERE item->>'id' = '${B_MESSAGE}'
    ) THEN
        RAISE EXCEPTION 'authorized conversation history incomplete';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'messages') AS item
        WHERE item->>'id' = '${C_MESSAGE}'
    ) THEN
        RAISE EXCEPTION 'unrelated message leaked';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'blocks_created') AS item
        WHERE item->>'blocked_user_id' = '${C}'
    ) THEN
        RAISE EXCEPTION 'caller-owned block missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'reports_submitted') AS item
        WHERE item->>'id' = '${REPORT_ID}'
    ) THEN
        RAISE EXCEPTION 'caller-owned report missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'generation_jobs') AS item
        WHERE item->>'message_id' = '${A_MESSAGE}'
    ) THEN
        RAISE EXCEPTION 'caller generation job missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(exported->'generation_jobs') AS item
        WHERE item->>'message_id' = '${B_MESSAGE}'
    ) THEN
        RAISE EXCEPTION 'other sender generation job leaked';
    END IF;

    IF POSITION('lease_token' IN exported::TEXT) > 0 THEN
        RAISE EXCEPTION 'internal worker lease token field leaked';
    END IF;

    IF POSITION('charlie must not leak' IN exported::TEXT) > 0 THEN
        RAISE EXCEPTION 'unrelated conversation text leaked';
    END IF;
END;
\$\$;
SQL
} | "${PSQL[@]}"

echo "PR-15 self-service data export integration checks passed."
