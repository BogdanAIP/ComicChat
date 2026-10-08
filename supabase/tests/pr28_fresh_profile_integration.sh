#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="28282828-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="28282828-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr28-alpha@example.test'),
  ('${B}', 'pr28-bravo@example.test');

UPDATE public."user"
SET username = 'pr28-bravo'
WHERE id = '${B}'::uuid;
SQL

PROFILE_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public."user" WHERE id IN ('${A}'::uuid, '${B}'::uuid);")"
[[ "${PROFILE_COUNT}" == "2" ]]

EMAILS="$("${PSQL[@]}" -c "SELECT string_agg(email, ',' ORDER BY email) FROM public."user" WHERE id IN ('${A}'::uuid, '${B}'::uuid);")"
[[ "${EMAILS}" == "pr28-alpha@example.test,pr28-bravo@example.test" ]]

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

OWN_COUNT="$(user_scalar "${A}" "SELECT COUNT(*) FROM public."user" WHERE id = '${A}'::uuid;")"
[[ "${OWN_COUNT}" == "1" ]]

FOREIGN_COUNT="$(user_scalar "${A}" "SELECT COUNT(*) FROM public."user" WHERE id = '${B}'::uuid;")"
[[ "${FOREIGN_COUNT}" == "0" ]]

UPDATED="$(user_scalar "${A}" "UPDATE public."user" SET username = 'pr28-alpha' WHERE id = '${A}'::uuid RETURNING username;")"
[[ "${UPDATED}" == "pr28-alpha" ]]

FOREIGN_UPDATE="$(user_scalar "${A}" "UPDATE public."user" SET username = 'should-not-change' WHERE id = '${B}'::uuid RETURNING username;")"
[[ -z "${FOREIGN_UPDATE}" ]]

BRAVO="$("${PSQL[@]}" -c "SELECT username FROM public."user" WHERE id = '${B}'::uuid;")"
[[ "${BRAVO}" == "pr28-bravo" ]]

SEARCH_RESULT="$(user_scalar "${A}" "SELECT username FROM public.comic_search_users('pr28-bra');")"
[[ "${SEARCH_RESULT}" == "pr28-bravo" ]]

if {
  cat <<SQL
SET ROLE anon;
SELECT * FROM public."user";
SQL
} | "${PSQL[@]}" >/dev/null 2>&1; then
  echo "anonymous caller unexpectedly read ComicChat profiles" >&2
  exit 1
fi

TRIGGER_COUNT="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'comic_auth_user_profile_insert' AND NOT tgisinternal;")"
[[ "${TRIGGER_COUNT}" == "1" ]]

echo "PR-28 fresh profile baseline checks passed."
