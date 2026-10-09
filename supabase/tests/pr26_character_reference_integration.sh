#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="26262626-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="26262626-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="26262626-cccc-4ccc-8ccc-cccccccccccc"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr26-a@example.test'),
  ('${B}', 'pr26-b@example.test'),
  ('${C}', 'pr26-c@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'pr26alpha', 'pr26-a@example.test'),
  ('${B}', 'pr26bravo', 'pr26-b@example.test'),
  ('${C}', 'pr26charlie', 'pr26-c@example.test')
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

service_scalar() {
  local statement="$1"
  {
    cat <<SQL
SET ROLE service_role;
${statement}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

complete_message() {
  local message_id="$1"
  local claimed job_id lease asset

  claimed="$(service_scalar "SELECT id::text || '|' || lease_token::text FROM public.comic_claim_generation_job_for_message('${message_id}'::uuid, 'openai-image', 180);")"
  job_id="${claimed%%|*}"
  lease="${claimed#*|}"
  asset="$("${PSQL[@]}" -c "SELECT attempt_asset_id FROM public.comic_generation_job WHERE id='${job_id}'::uuid;")"
  [[ -n "${job_id}" && -n "${lease}" ]]

  service_scalar "SELECT status FROM public.comic_complete_generation_job(
    '${job_id}'::uuid,
    '${lease}'::uuid,
    '{\"illustration\":{\"kind\":\"private-comic-art\",\"version\":1,\"asset_id\":\"${asset}\",\"mime_type\":\"image/webp\",\"containsText\":false}}'::jsonb,
    1,
    0
  );" >/dev/null

  service_scalar "SELECT source_message_id::text FROM public.comic_pin_character_reference('${message_id}'::uuid);"
}

service_scalar "UPDATE public.comic_generation_config
SET external_generation_enabled = TRUE,
    provider = 'openai-image',
    billing_source = 'comicchat-sponsored-beta',
    model = 'gpt-image-2.5-flare',
    updated_at = NOW()
WHERE singleton_id = 1
RETURNING provider;" >/dev/null

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
AC="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${C}'::uuid);")"
[[ -n "${AB}" && -n "${AC}" && "${AB}" != "${AC}" ]]

A1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '26260000-0000-4000-8000-000000000001'::uuid, 'first AB reference');")"
A2="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '26260000-0000-4000-8000-000000000002'::uuid, 'second AB frame');")"
AC1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AC}'::uuid, '26260000-0000-4000-8000-000000000003'::uuid, 'first AC reference');")"
B1="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '26260000-0000-4000-8000-000000000004'::uuid, 'first B reference');")"
UNREADY="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '26260000-0000-4000-8000-000000000005'::uuid, 'must not pin before ready');")"

if service_scalar "SELECT source_message_id FROM public.comic_pin_character_reference('${UNREADY}'::uuid);" >/dev/null 2>&1; then
  echo "unready generation unexpectedly became a character reference" >&2
  exit 1
fi

PIN_A1="$(complete_message "${A1}")"
[[ "${PIN_A1}" == "${A1}" ]]

PIN_A2="$(complete_message "${A2}")"
[[ "${PIN_A2}" == "${A1}" ]]

PIN_AC1="$(complete_message "${AC1}")"
[[ "${PIN_AC1}" == "${AC1}" ]]

PIN_B1="$(complete_message "${B1}")"
[[ "${PIN_B1}" == "${B1}" ]]

ROWS="$("${PSQL[@]}" -c "
SELECT user_id::text || '|' || conversation_id::text || '|' || source_message_id::text
FROM public.comic_character_reference
WHERE user_id IN ('${A}'::uuid, '${B}'::uuid)
ORDER BY user_id, conversation_id;
")"
COUNT="$(printf '%s\n' "${ROWS}" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "${COUNT}" == "3" ]]

A_AB_SOURCE="$("${PSQL[@]}" -c "SELECT source_message_id::text FROM public.comic_character_reference WHERE user_id='${A}'::uuid AND conversation_id='${AB}'::uuid;")"
A_AC_SOURCE="$("${PSQL[@]}" -c "SELECT source_message_id::text FROM public.comic_character_reference WHERE user_id='${A}'::uuid AND conversation_id='${AC}'::uuid;")"
B_AB_SOURCE="$("${PSQL[@]}" -c "SELECT source_message_id::text FROM public.comic_character_reference WHERE user_id='${B}'::uuid AND conversation_id='${AB}'::uuid;")"

[[ "${A_AB_SOURCE}" == "${A1}" ]]
[[ "${A_AC_SOURCE}" == "${AC1}" ]]
[[ "${B_AB_SOURCE}" == "${B1}" ]]
[[ "${A_AB_SOURCE}" != "${A_AC_SOURCE}" ]]

for USER_ID in "${A}" "${B}" "${C}"; do
  if user_scalar "${USER_ID}" "SELECT source_message_id FROM public.comic_character_reference LIMIT 1;" >/dev/null 2>&1; then
    echo "authenticated client unexpectedly read private character-reference metadata" >&2
    exit 1
  fi
done

echo "PR-26 conversation-scoped character reference checks passed."
