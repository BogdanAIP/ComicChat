#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)
A="35353535-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="35353535-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="35353535-cccc-4ccc-8ccc-cccccccccccc"
"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'episode-a@example.test'),
  ('${B}', 'episode-b@example.test'),
  ('${C}', 'episode-c@example.test');
INSERT INTO public."user"(id,username,email) VALUES
  ('${A}', 'episodealpha', 'episode-a@example.test'),
  ('${B}', 'episodebravo', 'episode-b@example.test'),
  ('${C}', 'episodecharlie', 'episode-c@example.test')
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email=EXCLUDED.email;
SQL

user_scalar() {
  local who="$1" sql="$2"
  {
    cat <<SQL
SET ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '${who}', false);
${sql}
SQL
  } | "${PSQL[@]}" | tail -n 1
}

AB="$(user_scalar "${A}" "SELECT public.comic_ensure_direct_conversation('${B}'::uuid);")"
M1="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '35353535-1111-4111-8111-111111111111'::uuid, 'First private panel');")"
M2="$(user_scalar "${B}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '35353535-2222-4222-8222-222222222222'::uuid, 'Second private panel');")"
M3="$(user_scalar "${A}" "SELECT id FROM public.comic_send_message('${AB}'::uuid, '35353535-3333-4333-8333-333333333333'::uuid, 'Future message excluded');")"
[[ -n "${M1}" && -n "${M2}" && -n "${M3}" ]]

R="$(user_scalar "${A}" "SELECT public.comic_propose_public_snapshot('${AB}'::uuid, '${M2}'::uuid);")"
[[ -n "${R}" ]]
# Before B's ONE consent, creation and publication must both be forbidden.
if user_scalar "${A}" "SELECT public.comic_release_approved_episode('${R}'::uuid, 'Our first story');" >/dev/null 2>&1; then
  echo "BUG: requester published without recipient approval" >&2
  exit 1
fi
# A nonmember cannot use another conversation's grant.
if user_scalar "${C}" "SELECT public.comic_release_approved_episode('${R}'::uuid, 'Impersonation');" >/dev/null 2>&1; then
  echo "BUG: nonmember published private conversation" >&2
  exit 1
fi

APPROVED="$(user_scalar "${B}" "SELECT public.comic_set_public_snapshot_consent('${R}'::uuid, TRUE);")"
[[ "${APPROVED}" = "t" || "${APPROVED}" = "true" ]]
# No second request: B's one approval covers creation and publication.
EPISODE="$(user_scalar "${A}" "SELECT public.comic_release_approved_episode('${R}'::uuid, 'Our first story');")"
[[ -n "${EPISODE}" ]]
DUP="$(user_scalar "${A}" "SELECT public.comic_release_approved_episode('${R}'::uuid, 'Changed title');")"
[[ "${EPISODE}" = "${DUP}" ]]

# C is unrelated to the private conversation yet can read the consented
# PUBLIC, immutable story. New message M3 must not leak past the cutoff.
VISIBLE="$(user_scalar "${C}" "SELECT COUNT(*) || '|' || (panels::text LIKE '%First private panel%')::text || '|' || (panels::text LIKE '%Second private panel%')::text || '|' || (panels::text LIKE '%Future message excluded%')::text FROM public.comic_list_released_episodes(30) WHERE episode_id = '${EPISODE}'::uuid GROUP BY panels;")"
[[ "${VISIBLE}" = "1|true|true|false" ]]

# Direct table access must stay denied even for authenticated visitors.
if user_scalar "${C}" "SELECT count(*) FROM public.comic_story_episode;" >/dev/null 2>&1; then
  echo "BUG: public snapshots accessible outside guarded RPC" >&2
  exit 1
fi

user_scalar "${B}" "SELECT public.comic_set_public_snapshot_consent('${R}'::uuid, FALSE);" >/dev/null
HIDDEN="$(user_scalar "${C}" "SELECT count(*) FROM public.comic_list_released_episodes(30) WHERE episode_id='${EPISODE}'::uuid;")"
[[ "${HIDDEN}" = "0" ]]
if user_scalar "${A}" "SELECT public.comic_release_approved_episode('${R}'::uuid, 'Try after revocation');" >/dev/null 2>&1; then
  echo "BUG: revoked permission still allows publication" >&2
  exit 1
fi

echo "PR-35 single-approval create + publish privacy checks passed."
