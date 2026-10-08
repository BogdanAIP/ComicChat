#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email)
VALUES ('${A}', 'beta-status-a@example.test');

INSERT INTO public."user"(id, username, email)
VALUES ('${A}', 'betastatusalpha', 'beta-status-a@example.test')
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

if {
  cat <<'SQL'
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', false);
SELECT stage FROM public.comic_get_beta_safety_status();
SQL
} | "${PSQL[@]}" >/dev/null 2>&1; then
  echo "unauthenticated beta safety status unexpectedly succeeded" >&2
  exit 1
fi

ROW="$(user_scalar "${A}" "
SELECT concat_ws('|',
  stage,
  generation_provider,
  external_generation_enabled,
  media_storage_enabled,
  public_publication_enabled,
  hard_delete_enabled,
  automated_retention_purge_enabled,
  retention_duration_defined,
  data_export_enabled,
  deletion_request_enabled,
  abuse_reporting_enabled,
  blocking_enabled,
  message_rate_limit_per_minute,
  incident_response_runbook_available
)
FROM public.comic_get_beta_safety_status();
")"

EXPECTED="closed_beta|mock|f|f|f|f|f|f|t|t|t|t|30|t"
[[ "${ROW}" == "${EXPECTED}" ]]

MEDIA_ROW="$(user_scalar "${A}" "
SELECT concat_ws('|',
  private_asset_storage_enabled,
  signed_asset_access_enabled,
  public_asset_urls_enabled,
  coalesce(active_media_provider, 'none')
)
FROM public.comic_get_media_capabilities();
")"
[[ "${MEDIA_ROW}" == "f|f|f|none" ]]

ACCOUNT_ROW="$(user_scalar "${A}" "
SELECT concat_ws('|', status, hard_delete_enabled)
FROM public.comic_get_my_account_state();
")"
[[ "${ACCOUNT_ROW}" == "active|f" ]]

echo "PR-22 closed-beta safety disclosure integration checks passed."
