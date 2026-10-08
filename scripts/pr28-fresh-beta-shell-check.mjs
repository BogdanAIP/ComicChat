import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-28 beta-shell gate missing: ${label}: ${needle}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-28 beta-shell gate forbidden: ${label}: ${needle}`)
  }
}

const migration = read('supabase/migrations/20261004090000_pr28_profile_baseline.sql')
const home = read('pages/index.js')
const ci = read('.github/workflows/ci.yml')
const staging = read('.github/workflows/staging-activation.yml')
const roadmap = read('ROADMAP.md')
const docs = read('docs/PR28_FRESH_BETA_SHELL.md')
const pkg = JSON.parse(read('package.json'))

for (const required of [
  'CREATE TABLE IF NOT EXISTS public."user"',
  'comic_profile_select_self',
  'comic_profile_insert_self',
  'comic_profile_update_self',
  'comic_auth_user_profile_insert',
  'AFTER INSERT ON auth.users',
  'GRANT SELECT, INSERT, UPDATE ON TABLE public."user" TO authenticated',
]) {
  expect(migration, required, 'fresh profile baseline')
}

for (const forbidden of [
  'public.message',
  'direct_message_thread',
  'direct_message',
  'chat-files',
]) {
  forbid(migration, forbidden, 'legacy upstream schema must not return')
}

expect(home, "useState('private')", 'ComicChat must be the default signed-in tab')
expect(home, "import ComicDirectMessages from '../components/ComicDirectMessages'", 'reuse protected ComicChat component')
expect(home, '<title>ComicChat</title>', 'ComicChat product metadata')
expect(home, '>ComicChat</div>', 'ComicChat navigation entry')
expect(home, "onBack={() => setTab('private')}", 'profile returns to ComicChat')

for (const forbidden of [
  "import Chat from '../components/Chat'",
  "setTab('public')",
  "tab === 'public'",
  '{t.publicChat}',
]) {
  forbid(home, forbidden, 'legacy public chat must not be in beta shell')
}

expect(ci, 'Apply PR-28 profile baseline', 'plain PostgreSQL CI applies fresh baseline')
expect(ci, '20261004090000_pr28_profile_baseline.sql', 'fresh baseline migration path')
expect(ci, 'pr28_fresh_profile_integration.sh', 'fresh-profile RLS integration')
forbid(ci, 'CREATE TABLE public."user" (', 'CI must not synthesize the profile table manually')
forbid(ci, 'CREATE TABLE IF NOT EXISTS public."user" (', 'local Supabase CI must not synthesize profile table')

expect(staging, 'supabase db push --dry-run', 'staging plan sees baseline migration')
expect(staging, 'supabase db push', 'staging deploy applies baseline migration')

for (const required of [
  'minimal profile baseline',
  'ComicChat-first',
  'does not recreate',
  'Vercel',
]) {
  expect(docs, required, 'fresh beta shell documentation')
}

expect(roadmap, '| PR-28 |', 'roadmap PR-28 milestone')

if (pkg.scripts?.['beta:pr28'] !== 'node scripts/pr28-fresh-beta-shell-check.mjs') {
  throw new Error('PR-28 beta:pr28 script missing from package.json')
}

console.log('PR-28 fresh beta shell boundaries passed.')
