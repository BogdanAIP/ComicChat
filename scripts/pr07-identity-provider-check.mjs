import fs from 'node:fs'
import path from 'node:path'

const read = (relativePath) =>
  fs.readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8')

const manifest = JSON.parse(
  read('docs/permissions/pr07-openai-capabilities.json')
)
const docs = read('docs/PR07_IDENTITY_PROVIDER_PERMISSION_SPIKE.md')
const provider = read('utils/generationProvider.mjs')
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
  failures.push('permission manifest schemaVersion must be 1')
}

if (manifest.chatGPTPlanUsage?.imageGeneration !== 'unsupported-in-current-preview') {
  failures.push('ChatGPT plan image generation must remain unsupported until verified')
}

if (manifest.chatGPTPlanUsage?.supportedForComicImageSenderPays !== false) {
  failures.push('sender-pays ChatGPT-plan images must remain disabled')
}

if (manifest.providerDecision?.officialImageProvider !== 'disabled') {
  failures.push('official image provider must remain disabled in PR-07')
}

if (manifest.localIdentity?.emailMayBeLinkKey !== false) {
  failures.push('email must not be the durable OpenAI identity link key')
}

requireText(
  docs,
  'BLOCKED for comic image generation',
  'explicit sender-pays image block'
)
requireText(
  docs,
  'local ComicChat user ID',
  'local identity remains canonical'
)
requireText(
  docs,
  'no token in NEXT_PUBLIC variables',
  'browser-public token boundary'
)

requireText(
  provider,
  "if (normalized === 'official-image')",
  'explicit official-image provider branch'
)
requireText(
  provider,
  'OfficialImageAPIProvider is not enabled in PR-05',
  'official image provider remains disabled'
)
forbidText(provider, 'fetch(', 'provider network call added before approval')
forbidText(provider, 'OPENAI_API_KEY', 'provider API secret added before approval')

for (const attribution of [
  'sender_id',
  'provider',
  'billing_source',
  'comic_usage_ledger',
]) {
  requireText(pr05, attribution, 'PR-05 sender/provider attribution: ' + attribution)
}

const runtimeFiles = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(absolute)
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(entry.name)) runtimeFiles.push(absolute)
  }
}
for (const root of ['components', 'pages', 'utils']) {
  if (fs.existsSync(root)) collect(root)
}

const runtimeSource = runtimeFiles
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

for (const forbidden of [
  'auth.openai.com/api/accounts/oauth',
  'chatgpt.tokens.use.direct',
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_OPENAI',
  'dynamic_agent_client',
]) {
  forbidText(
    runtimeSource,
    forbidden,
    'unapproved OpenAI auth/provider runtime code: ' + forbidden
  )
}

for (const tokenSink of [
  /localStorage\.(?:setItem|getItem)\([^\n]*(?:access|refresh)[_-]?token/i,
  /sessionStorage\.(?:setItem|getItem)\([^\n]*(?:access|refresh)[_-]?token/i,
  /NEXT_PUBLIC_[A-Z0-9_]*(?:TOKEN|SECRET|OPENAI)/,
]) {
  if (tokenSink.test(runtimeSource)) {
    failures.push('runtime source contains a browser/public bearer-token storage pattern')
  }
}

if (failures.length) {
  console.error('PR-07 identity/provider permission gate failed:')
  for (const failure of failures) console.error('- ' + failure)
  process.exit(1)
}

console.log('PR-07 identity/provider permission gate passed.')
