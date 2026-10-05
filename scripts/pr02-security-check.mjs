import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const ui = read('components/ComicDirectMessages.js')
const page = read('pages/index.js')
const migration = read('supabase/migrations/20261005_pr02_secure_private_chat.sql')

const failures = []

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`missing: ${label}`)
}

const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`forbidden: ${label}`)
}

requireText(
  page,
  "import ComicDirectMessages from '../components/ComicDirectMessages'",
  'private UI imports ComicDirectMessages'
)
forbidText(
  page,
  "import DirectMessages from '../components/DirectMessages'",
  'private UI must not import legacy DirectMessages'
)

for (const legacy of [
  'direct_message',
  'ensure_dm_thread',
  'notify-direct-message',
  'fileUpload',
  'getPublicUrl',
  'cloudinary',
]) {
  forbidText(
    ui.toLowerCase(),
    legacy.toLowerCase(),
    `secure UI references legacy/public path: ${legacy}`
  )
}

for (const rpc of [
  'comic_ensure_direct_conversation',
  'comic_list_direct_conversations',
  'comic_search_users',
  'comic_send_message',
  'comic_mark_conversation_delivered',
  'comic_mark_conversation_read',
]) {
  requireText(ui, rpc, `secure UI RPC ${rpc}`)
}

for (const table of [
  'comic_conversation',
  'comic_membership',
  'comic_message',
  'comic_message_receipt',
]) {
  requireText(migration, table, `migration table ${table}`)
}

requireText(migration, 'client_nonce UUID NOT NULL', 'message client nonce')
requireText(
  migration,
  'UNIQUE (conversation_id, sender_id, client_nonce)',
  'message idempotency uniqueness'
)
requireText(migration, 'auth.uid()', 'server-derived identity')
requireText(migration, 'SECURITY DEFINER', 'secured RPC boundary')
requireText(migration, 'SET search_path = pg_catalog', 'fixed SECURITY DEFINER search_path')
requireText(
  migration,
  'REVOKE ALL ON TABLE public.comic_message FROM anon, authenticated',
  'message direct-write revocation'
)
requireText(
  migration,
  'GRANT SELECT ON TABLE public.comic_message TO authenticated',
  'message read grant'
)
requireText(migration, 'DO $$', 'valid PostgreSQL DO block opener')
requireText(migration, 'END $$;', 'valid PostgreSQL DO block closer')

forbidText(migration, 'WITH CHECK (true)', 'permissive RLS insertion')
forbidText(migration, 'getPublicUrl', 'public media URL')
forbidText(migration, 'recipientEmail', 'caller-controlled notification recipient')

const definerCount = (migration.match(/SECURITY DEFINER/g) || []).length
const fixedSearchPathCount = (migration.match(/SET search_path = pg_catalog/g) || []).length

if (definerCount === 0 || definerCount !== fixedSearchPathCount) {
  failures.push(
    `every SECURITY DEFINER must pin search_path: definers=${definerCount}, pinned=${fixedSearchPathCount}`
  )
}

if (
  /GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+TABLE\s+public\.comic_message\s+TO\s+authenticated/i.test(
    migration
  )
) {
  failures.push('forbidden: authenticated direct write grant on comic_message')
}

if (
  /CREATE\s+POLICY\s+[^\n]+\s+ON\s+public\.comic_membership/i.test(migration)
) {
  failures.push('forbidden: browser-facing comic_membership policy')
}

if (!/DO \$\$\s*BEGIN[\s\S]*END \$\$;/.test(migration)) {
  failures.push('invalid or missing PostgreSQL dollar-quoted DO block')
}

if (failures.length) {
  console.error('PR-02 security boundary check failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('PR-02 security boundary check passed.')
