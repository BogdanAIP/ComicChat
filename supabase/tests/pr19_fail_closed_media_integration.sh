#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="19191919-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="19191919-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'media-a@example.test'),
  ('${B}', 'media-b@example.test');

INSERT INTO public."user"(id, username, email) VALUES
  ('${A}', 'mediaalpha', 'media-a@example.test'),
  ('${B}', 'mediabravo', 'media-b@example.test');
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
MESSAGE="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${CONVERSATION}'::uuid, '19190000-0000-4000-8000-000000000001'::uuid, 'media guard test');")"
[[ -n "${CONVERSATION}" && -n "${MESSAGE}" ]]

JOB="$("${PSQL[@]}" -c "SELECT id FROM public.comic_generation_job WHERE message_id = '${MESSAGE}'::uuid;")"
LEASE="19190000-0000-4000-8000-000000000099"
[[ -n "${JOB}" ]]

# Arrange only this test's job into a valid worker-owned rendering state.
# Do not use comic_claim_generation_job() here: the shared CI database may
# contain older queued jobs from previous integration cases, and the worker
# claim API intentionally chooses the oldest global candidate.
"${PSQL[@]}" <<SQL
UPDATE public.comic_generation_job
SET
  status = 'rendering',
  attempt_count = 1,
  lease_token = '${LEASE}'::uuid,
  lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes',
  updated_at = CURRENT_TIMESTAMP
WHERE id = '${JOB}'::uuid;

UPDATE public.comic_message
SET status = 'rendering', updated_at = CURRENT_TIMESTAMP
WHERE id = '${MESSAGE}'::uuid;
SQL

RENDERING_STATE="$("${PSQL[@]}" -c "SELECT status || '|' || lease_token::text FROM public.comic_generation_job WHERE id = '${JOB}'::uuid;")"
[[ "${RENDERING_STATE}" == "rendering|${LEASE}" ]]

if service_scalar "SELECT status FROM public.comic_complete_generation_job(
  '${JOB}'::uuid,
  '${LEASE}'::uuid,
  '{"illustration":{"kind":"mock-comic-art","public_url":"https://example.invalid/a.png"}}'::jsonb
);" >/dev/null 2>&1; then
  echo "public_url unexpectedly persisted while media is disabled" >&2
  exit 1
fi

STATUS_AFTER_URL="$("${PSQL[@]}" -c "SELECT status FROM public.comic_generation_job WHERE id = '${JOB}'::uuid;")"
[[ "${STATUS_AFTER_URL}" == "rendering" ]]

if service_scalar "SELECT status FROM public.comic_complete_generation_job(
  '${JOB}'::uuid,
  '${LEASE}'::uuid,
  '{"illustration":{"kind":"mock-comic-art","object_key":"private/messages/a.png"}}'::jsonb
);" >/dev/null 2>&1; then
  echo "object_key unexpectedly persisted while media is disabled" >&2
  exit 1
fi

READY="$(service_scalar "SELECT status FROM public.comic_complete_generation_job(
  '${JOB}'::uuid,
  '${LEASE}'::uuid,
  '{"illustration":{"kind":"mock-comic-art","version":1,"containsText":false}}'::jsonb
);")"
[[ "${READY}" == "ready" ]]

LOCATOR_COUNT="$("${PSQL[@]}" -c "
SELECT COUNT(*)
FROM public.comic_generation_job
WHERE output_descriptor::text ~* '"(url|uri|public_url|signed_url|download_url|object_key|storage_key|bucket|storage_bucket)"[[:space:]]*:';
")"
[[ "${LOCATOR_COUNT}" == "0" ]]

CAPS="$(user_scalar "${A}" "SELECT client_upload_enabled::text || '|' || private_asset_storage_enabled::text || '|' || signed_asset_access_enabled::text || '|' || public_asset_urls_enabled::text || '|' || COALESCE(active_media_provider, 'none') || '|' || max_output_descriptor_bytes::text FROM public.comic_get_media_capabilities();")"
[[ "${CAPS}" == "false|false|false|false|none|65536" ]]

if {
  cat <<SQL
SET ROLE anon;
SELECT * FROM public.comic_get_media_capabilities();
SQL
} | "${PSQL[@]}" >/dev/null 2>&1; then
  echo "anonymous caller unexpectedly read media capabilities RPC" >&2
  exit 1
fi

if user_scalar "${A}" "UPDATE public.comic_generation_job SET output_descriptor = '{\"public_url\":\"https://example.invalid\"}'::jsonb WHERE id = '${JOB}'::uuid;" >/dev/null 2>&1; then
  echo "authenticated browser unexpectedly mutated generation output" >&2
  exit 1
fi

echo "PR-19 fail-closed media boundary checks passed."
