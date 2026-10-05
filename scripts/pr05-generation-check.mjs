import fs from 'node:fs'
import {
  createGenerationProvider,
  MockProvider,
  TemplateRendererProvider,
} from '../utils/generationProvider.mjs'

const read = (path) =>
  fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const migration = read(
  'supabase/migrations/20261005130000_pr05_generation_pipeline.sql'
)
const workflow = read('.github/workflows/ci.yml')
const failures = []

const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push('missing: ' + label)
}

const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push('forbidden: ' + label)
}

for (const table of ['comic_generation_job', 'comic_usage_ledger']) {
  requireText(migration, table, 'PR-05 table ' + table)
}

for (const fn of [
  'comic_enqueue_generation_for_message',
  'comic_claim_generation_job',
  'comic_complete_generation_job',
  'comic_fail_generation_job',
]) {
  requireText(migration, fn, 'PR-05 function ' + fn)
}

requireText(
  migration,
  'PERFORM public.comic_enqueue_generation_for_message(',
  'message send atomically enqueues generation'
)
requireText(
  migration,
  'UNIQUE (job_id, attempt_no, event_type)',
  'ledger event idempotency'
)
requireText(
  migration,
  'message_id UUID NOT NULL UNIQUE',
  'one generation job per message'
)
requireText(
  migration,
  'FOR UPDATE SKIP LOCKED',
  'concurrent worker claim'
)
requireText(
  migration,
  'lease_expires_at <= now_utc',
  'expired worker lease handling'
)
requireText(
  migration,
  'attempt_count < current_job.max_attempts',
  'bounded retry decision'
)
requireText(
  migration,
  'USING (sender_id = auth.uid())',
  'sender-only generation accounting reads'
)
requireText(
  migration,
  'TO service_role',
  'trusted worker execution grant'
)
requireText(
  migration,
  'FROM PUBLIC, anon, authenticated',
  'worker RPC client revocation'
)
requireText(
  workflow,
  '20261005130000_pr05_generation_pipeline.sql',
  'PR-05 migration in PostgreSQL CI'
)
requireText(
  workflow,
  'pr05_generation_pipeline_integration.sh',
  'PR-05 transactional integration in CI'
)

forbidText(
  migration,
  'GRANT INSERT ON TABLE public.comic_generation_job TO authenticated',
  'browser direct generation-job insert'
)
forbidText(
  migration,
  'GRANT UPDATE ON TABLE public.comic_generation_job TO authenticated',
  'browser direct generation-job update'
)
forbidText(
  migration,
  'GRANT INSERT ON TABLE public.comic_usage_ledger TO authenticated',
  'browser direct ledger insert'
)

const providerSource = read('utils/generationProvider.mjs')
for (const forbidden of [
  'fetch(',
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_OPENAI',
  'Math.random(',
  'Date.now(',
]) {
  forbidText(
    providerSource,
    forbidden,
    'PR-05 provider side effect/secret: ' + forbidden
  )
}

const mock = createGenerationProvider('mock')
const template = createGenerationProvider('template')

if (!(mock instanceof MockProvider)) {
  failures.push('mock provider factory returned the wrong provider')
}
if (!(template instanceof TemplateRendererProvider)) {
  failures.push('template provider factory returned the wrong provider')
}

const secretText = 'EXACT SOURCE TEXT MUST NOT BE DRAWN BY THE MOCK PROVIDER'
const mockResult = await mock.generate({
  messageId: '11111111-1111-4111-8111-111111111111',
  sceneKey: 'rain',
  characterToken: 'template-2',
  text: secretText,
})

if (mockResult.provider !== 'mock' || mockResult.billingSource !== 'mock') {
  failures.push('mock provider identity/billing source mismatch')
}
if (mockResult.billableUnits !== 0 || mockResult.costMicrounits !== 0) {
  failures.push('mock provider must never report billable usage')
}
if (mockResult.illustration?.containsText !== false) {
  failures.push('mock illustration must explicitly contain no text')
}
if (JSON.stringify(mockResult).includes(secretText)) {
  failures.push('mock illustration output leaked source text into generated art')
}

const exact = '  Keep this exact line.\nSecond line 🙂  '
const templateResult = await template.generate({
  messageId: '22222222-2222-4222-8222-222222222222',
  text: exact,
  mine: true,
})

if (templateResult.renderModel?.text !== exact) {
  failures.push('TemplateRendererProvider changed original source text')
}

let officialDisabled = false
try {
  createGenerationProvider('official-image')
} catch (error) {
  officialDisabled = String(error?.message || '').includes('not enabled')
}
if (!officialDisabled) {
  failures.push('official image provider must remain disabled in PR-05')
}

if (failures.length) {
  console.error('PR-05 generation pipeline boundary check failed:')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PR-05 generation pipeline boundary check passed.')
