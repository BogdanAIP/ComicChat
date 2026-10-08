#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="30303030-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="30303030-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr30-a@example.test'),
  ('${B}', 'pr30-b@example.test');
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

INITIAL="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public."user" WHERE id IN ('${A}'::uuid, '${B}'::uuid) AND username IS NULL;")"
[[ "${INITIAL}" == "2" ]]

A_SET="$(user_scalar "${A}" "UPDATE public."user" SET username = 'BetaAlice' WHERE id = '${A}'::uuid RETURNING username;")"
[[ "${A_SET}" == "BetaAlice" ]]

B_SET="$(user_scalar "${B}" "UPDATE public."user" SET username = 'BetaBob' WHERE id = '${B}'::uuid RETURNING username;")"
[[ "${B_SET}" == "BetaBob" ]]

if user_scalar "${B}" "UPDATE public."user" SET username = 'betaalice' WHERE id = '${B}'::uuid RETURNING username;" >/dev/null 2>&1; then
  echo "case-insensitive duplicate username unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "UPDATE public."user" SET username = ' BetaAlice ' WHERE id = '${A}'::uuid RETURNING username;" >/dev/null 2>&1; then
  echo "username with edge whitespace unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "UPDATE public."user" SET username = 'x' WHERE id = '${A}'::uuid RETURNING username;" >/dev/null 2>&1; then
  echo "one-character username unexpectedly succeeded" >&2
  exit 1
fi

if user_scalar "${A}" "UPDATE public."user" SET username = '123456789012345678901234567890123' WHERE id = '${A}'::uuid RETURNING username;" >/dev/null 2>&1; then
  echo "33-character username unexpectedly succeeded" >&2
  exit 1
fi

SEARCH="$(user_scalar "${B}" "SELECT username FROM public.comic_search_users('betaali');")"
[[ "${SEARCH}" == "BetaAlice" ]]

FOREIGN_UPDATE="$(user_scalar "${A}" "UPDATE public."user" SET username = 'Hijacked' WHERE id = '${B}'::uuid RETURNING username;")"
[[ -z "${FOREIGN_UPDATE}" ]]

FINAL_B="$("${PSQL[@]}" -c "SELECT username FROM public."user" WHERE id = '${B}'::uuid;")"
[[ "${FINAL_B}" == "BetaBob" ]]

echo "PR-30 required username identity checks passed."
