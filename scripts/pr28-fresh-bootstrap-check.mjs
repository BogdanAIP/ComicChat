import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-28 bootstrap gate missing: ${label}: ${needle}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-28 bootstrap gate forbidden: ${label}: ${needle}`)
  }
}

const migration = read('supabase/migrations/20261005_pr02_secure_private_chat.sql')
const ci = read('.github/workflows/ci.yml')
const realtime = read('supabase/tests/pr02_realtime_integration.mjs')
const negativeRealtime = read('supabase/tests/pr18_realtime_negative_security.mjs')
const mcpAcceptance = read('supabase/tests/pr23_mcp_two_account_integration.mjs')
const mediaAcceptance = read('supabase/tests/pr25_private_media_integration.mjs')
const integration = read('supabase/tests/pr28_profile_bootstrap_integration.sh')
const docs = read('docs/PR28_FRESH_SUPABASE_BOOTSTRAP.md')
const roadmap = read('ROADMAP.md')
const pkg = JSON.parse(read('package.json'))

for (const required of [
  'CREATE TABLE IF NOT EXISTS public."user"',
  'comic_profile_select_self',
  'comic_profile_insert_self',
  'comic_profile_update_self',
  'CREATE OR REPLACE FUNCTION public.handle_new_user()',
  'CREATE TRIGGER on_auth_user_created',
  'DROP POLICY IF EXISTS "Users can view all profiles"',
  'REVOKE ALL ON TABLE public."user" FROM anon, authenticated',
  'GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO authenticated',
]) {
  expect(migration, required, 'self-contained profile baseline')
}

forbid(
  ci,
  'Bootstrap least-privilege legacy profile table for MCP acceptance',
  'MCP CI must not hide migration dependency'
)
forbid(
  ci,
  'Bootstrap legacy profile table required by user discovery',
  'Realtime CI must not hide migration dependency'
)

const prePr02 = ci.split('- name: Apply PR-02 migration')[0]
forbid(
  prePr02,
  'CREATE TABLE public."user"',
  'plain PostgreSQL CI must not create profile table before PR-02'
)

expect(realtime, ".from('user')\n    .update(", 'Realtime fixture uses trigger-created profile')
expect(negativeRealtime, ".from('user')\n    .update(", 'negative Realtime fixture uses trigger-created profile')
expect(mcpAcceptance, 'function upsertProfile(', 'MCP fixture tolerates signup trigger')
expect(mediaAcceptance, 'function upsertProfile(', 'media fixture tolerates signup trigger')

for (const required of [
  'signup creates a profile',
  'cross-user insert fails',
  'anonymous profile reads fail',
  'on_auth_user_created',
]) {
  expect(docs + integration, required, 'fresh bootstrap acceptance')
}

expect(roadmap, '| PR-28 |', 'roadmap PR-28 milestone')

if (pkg.scripts?.['bootstrap:pr28'] !== 'node scripts/pr28-fresh-bootstrap-check.mjs') {
  throw new Error('PR-28 bootstrap gate script missing from package.json')
}

console.log('PR-28 fresh Supabase bootstrap boundaries passed.')
