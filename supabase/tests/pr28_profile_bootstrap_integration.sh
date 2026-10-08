#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
PSQL=(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qAt)

A="28282828-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B="28282828-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
C="28282828-cccc-4ccc-8ccc-cccccccccccc"
D="28282828-dddd-4ddd-8ddd-dddddddddddd"

"${PSQL[@]}" <<SQL
INSERT INTO auth.users(id, email) VALUES
  ('${A}', 'pr28-a@example.test'),
  ('${B}', 'pr28-b@example.test'),
  ('${C}', 'pr28-c@example.test'),
  ('${D}', 'pr28-d@example.test');
SQL

created="$("${PSQL[@]}" -c "
  SELECT string_agg(id::text || ':' || coalesce(email, ''), ',' ORDER BY id)
  FROM public.\"user\"
  WHERE id IN ('${A}'::uuid, '${B}'::uuid, '${C}'::uuid, '${D}'::uuid);
")"

for expected in   "${A}:pr28-a@example.test"   "${B}:pr28-b@example.test"   "${C}:pr28-c@example.test"   "${D}:pr28-d@example.test"
do
  grep -q "${expected}" <<<"${created}"
done

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

own_count="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.\"user\" WHERE id = '${A}'::uuid;")"
[[ "${own_count}" == "1" ]]

foreign_count="$(user_scalar "${A}" "SELECT COUNT(*) FROM public.\"user\" WHERE id = '${B}'::uuid;")"
[[ "${foreign_count}" == "0" ]]

updated="$(user_scalar "${A}" "
  UPDATE public.\"user\"
  SET username = 'pr28-alpha'
  WHERE id = '${A}'::uuid
  RETURNING username;
")"
[[ "${updated}" == "pr28-alpha" ]]

foreign_update="$(user_scalar "${A}" "
  WITH changed AS (
    UPDATE public.\"user\"
    SET username = 'must-not-change'
    WHERE id = '${B}'::uuid
    RETURNING 1
  )
  SELECT COUNT(*) FROM changed;
")"
[[ "${foreign_update}" == "0" ]]

timestamp_ok="$("${PSQL[@]}" -c "
  SELECT (updated_at >= created_at)::text
  FROM public.\"user\"
  WHERE id = '${A}'::uuid;
")"
[[ "${timestamp_ok}" == "true" ]]

# Prove browser self-insert still works if a profile ever needs repair.
"${PSQL[@]}" -c "DELETE FROM public.\"user\" WHERE id = '${C}'::uuid;" >/dev/null
self_insert="$(user_scalar "${C}" "
  INSERT INTO public.\"user\"(id, username, email)
  VALUES ('${C}'::uuid, 'pr28-charlie', 'pr28-c@example.test')
  RETURNING username;
")"
[[ "${self_insert}" == "pr28-charlie" ]]

# A caller cannot create another user's profile.
"${PSQL[@]}" -c "DELETE FROM public.\"user\" WHERE id = '${D}'::uuid;" >/dev/null
if user_scalar "${C}" "
  INSERT INTO public.\"user\"(id, username, email)
  VALUES ('${D}'::uuid, 'intrusion', 'pr28-d@example.test')
  RETURNING username;
" >/dev/null 2>&1; then
  echo "authenticated caller unexpectedly inserted another user's profile" >&2
  exit 1
fi

if {
  cat <<SQL
SET ROLE anon;
SELECT * FROM public."user" WHERE id = '${A}'::uuid;
SQL
} | "${PSQL[@]}" >/dev/null 2>&1; then
  echo "anonymous caller unexpectedly read ComicChat profiles" >&2
  exit 1
fi

trigger_name="$("${PSQL[@]}" -c "
  SELECT tgname
  FROM pg_trigger
  WHERE tgrelid = 'auth.users'::regclass
    AND tgname = 'on_auth_user_created'
    AND NOT tgisinternal;
")"
[[ "${trigger_name}" == "on_auth_user_created" ]]

echo "PR-28 fresh profile bootstrap checks passed."
