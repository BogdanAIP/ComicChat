#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="25252525-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="25252525-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr25-a@example.test'),
  ('${B}', 'pr25-b@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'pr25alpha', 'pr25-a@example.test'),
  ('${B}', 'pr25bravo', 'pr25-b@example.test');
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

CONVERSATION="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
[[ -n "${CONVERSATION}" ]]

DEFAULT_MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION}'::uuid, '25250000-0000-4000-8000-000000000001'::uuid, 'default stays mock');")"
DEFAULT_JOB="$("${PSQL[@]}" -c "SELECT provider || '|' || billing_source FROM public.comic_generation_job WHERE message_id = '${DEFAULT_MESSAGE}'::uuid;")"
[[ "${DEFAULT_JOB}" == "mock|mock" ]]

DEFAULT_SAFETY="$(user_scalar "${A}" "SELECT generation_provider || '|' || external_generation_enabled::text || '|' || media_storage_enabled::text FROM public.comic_get_beta_safety_status();")"
[[ "${DEFAULT_SAFETY}" == "mock|false|false" ]]

if user_scalar "${A}" "UPDATE public.comic_generation_config SET external_generation_enabled = TRUE WHERE singleton_id = 1;" >/dev/null 2>&1; then
  echo "authenticated browser unexpectedly changed generation provider config" >&2
  exit 1
fi

service_scalar "UPDATE public.comic_generation_config SET external_generation_enabled = TRUE, provider = 'openai-image', billing_source = 'comicchat-sponsored-beta', model = 'gpt-image-2.5-flare', updated_at = NOW() WHERE singleton_id = 1 RETURNING provider;" >/dev/null

EXTERNAL_MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION}'::uuid, '25250000-0000-4000-8000-000000000002'::uuid, 'external provider test');")"
EXTERNAL_JOB="$("${PSQL[@]}" -c "SELECT provider || '|' || billing_source FROM public.comic_generation_job WHERE message_id = '${EXTERNAL_MESSAGE}'::uuid;")"
[[ "${EXTERNAL_JOB}" == "openai-image|comicchat-sponsored-beta" ]]

EXTERNAL_SAFETY="$(user_scalar "${A}" "SELECT generation_provider || '|' || external_generation_enabled::text || '|' || media_storage_enabled::text FROM public.comic_get_beta_safety_status();")"
[[ "${EXTERNAL_SAFETY}" == "openai-image|true|false" ]]

CLAIMED="$(service_scalar "SELECT provider || '|' || status || '|' || attempt_count::text || '|' || (lease_token IS NOT NULL)::text FROM public.comic_claim_generation_job_for_message('${EXTERNAL_MESSAGE}'::uuid, 'openai-image', 180);")"
[[ "${CLAIMED}" == "openai-image|rendering|1|true" ]]

LEASE="$("${PSQL[@]}" -c "SELECT lease_token::text FROM public.comic_generation_job WHERE message_id = '${EXTERNAL_MESSAGE}'::uuid;")"
JOB_ID="$("${PSQL[@]}" -c "SELECT id::text FROM public.comic_generation_job WHERE message_id = '${EXTERNAL_MESSAGE}'::uuid;")"
[[ -n "${LEASE}" && -n "${JOB_ID}" ]]

FAILED="$(service_scalar "SELECT status FROM public.comic_fail_generation_job('${JOB_ID}'::uuid, '${LEASE}'::uuid, 'test_cleanup', NULL, FALSE);")"
[[ "${FAILED}" == "failed" ]]

service_scalar "UPDATE public.comic_generation_config SET external_generation_enabled = FALSE, updated_at = NOW() WHERE singleton_id = 1 RETURNING external_generation_enabled::text;" >/dev/null

AFTER_MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION}'::uuid, '25250000-0000-4000-8000-000000000003'::uuid, 'back to mock');")"
AFTER_JOB="$("${PSQL[@]}" -c "SELECT provider || '|' || billing_source FROM public.comic_generation_job WHERE message_id = '${AFTER_MESSAGE}'::uuid;")"
[[ "${AFTER_JOB}" == "mock|mock" ]]

if {
  cat <<SQL
SET ROLE anon;
SELECT * FROM public.comic_generation_config;
SQL
} | "${PSQL[@]}" >/dev/null 2>&1; then
  echo "anonymous caller unexpectedly read generation provider config" >&2
  exit 1
fi

echo "PR-25 opt-in generation provider checks passed."
