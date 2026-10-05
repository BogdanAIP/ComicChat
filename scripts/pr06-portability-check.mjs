import fs from 'node:fs'

const read = (path) =>
  fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const manifest = JSON.parse(
  read('docs/portability/pr06-sites-capabilities.json')
)
const docs = read('docs/PR06_SITES_DEPLOYMENT_SPIKE.md')
const supabaseHook = read('utils/useSupabase.js')
const chat = read('components/ComicDirectMessages.js')
const pr02 = read('supabase/migrations/20261005_pr02_secure_private_chat.sql')
const pr05 = read(
  'supabase/migrations/20261005130000_pr05_generation_pipeline.sql'
)

const failures = []

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push('missing: ' + label)
}

const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push('forbidden: ' + label)
}

if (manifest.schemaVersion !== 1) {
  failures.push('capability manifest schemaVersion must be 1')
}

if (manifest.decision !== 'frontend-runtime-spike-keep-supabase-backend') {
  failures.push('PR-06 decision must retain Supabase for the first Sites spike')
}

if (manifest.deploymentStatus !== 'not-yet-tested-in-chatgpt-sites') {
  failures.push(
    'repository must not claim a Sites deployment before the real runtime test'
  )
}

const boundaryIds = new Set(
  (manifest.boundaries || []).map((boundary) => boundary.id)
)

for (const required of [
  'web-build',
  'identity',
  'data',
  'authorization',
  'realtime',
  'generation-worker',
  'media',
  'legacy-upload-email',
]) {
  if (!boundaryIds.has(required)) {
    failures.push('missing portability boundary: ' + required)
  }
}

requireText(
  docs,
  'NO-GO',
  'explicit no-go for immediate backend migration'
)
requireText(
  docs,
  'deployment compatibility not yet proven',
  'no premature Sites deployment claim'
)
requireText(
  docs,
  'https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites',
  'official Sites evidence link'
)

requireText(
  supabaseHook,
  'createClient(',
  'current Supabase client coupling'
)
requireText(
  supabaseHook,
  'supabase.auth.',
  'current Supabase Auth coupling'
)
requireText(
  chat,
  "supabase.rpc('comic_",
  'ComicChat RPC coupling'
)
requireText(
  chat,
  ".from('comic_message')",
  'ComicChat PostgREST message coupling'
)
requireText(
  chat,
  '.channel(',
  'ComicChat private Realtime coupling'
)
requireText(
  chat,
  'config: { private: true }',
  'private Realtime channel contract'
)

for (const primitive of [
  'ENABLE ROW LEVEL SECURITY',
  'auth.uid()',
  'SECURITY DEFINER',
  'SET search_path = pg_catalog',
]) {
  requireText(
    pr02,
    primitive,
    'PR-02 PostgreSQL security primitive: ' + primitive
  )
}

for (const primitive of [
  'comic_generation_job',
  'comic_usage_ledger',
  'FOR UPDATE SKIP LOCKED',
  'TO service_role',
]) {
  requireText(
    pr05,
    primitive,
    'PR-05 worker/ledger primitive: ' + primitive
  )
}

forbidText(
  chat,
  "from '../utils/fileUpload",
  'legacy upload helper imported by secure private path'
)
forbidText(
  chat,
  'notify-direct-message',
  'legacy email notification used by secure private path'
)
forbidText(
  chat,
  'supabase.storage',
  'public storage used by secure private path'
)

const combined = JSON.stringify(manifest) + '\n' + docs
for (const claim of [
  '"deploymentStatus":"deployed"',
  '"deploymentStatus":"compatible"',
  'ChatGPT Sites deployment PASS',
]) {
  forbidText(
    combined,
    claim,
    'unverified deployment claim: ' + claim
  )
}

if (failures.length) {
  console.error('PR-06 Sites portability gate failed:')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PR-06 Sites portability boundary check passed.')
