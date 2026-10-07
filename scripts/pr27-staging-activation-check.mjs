import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-27 staging gate missing: ${label}: ${needle}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-27 staging gate forbidden: ${label}: ${needle}`)
  }
}

const workflow = read('.github/workflows/staging-activation.yml')
const docs = read('docs/PR27_STAGING_ACTIVATION.md')
const roadmap = read('ROADMAP.md')
const pkg = JSON.parse(read('package.json'))

for (const required of [
  'workflow_dispatch:',
  'environment: comicchat-staging',
  'default: plan',
  'default: leave-disabled',
  'supabase link',
  'supabase db push --dry-run',
  'supabase db push',
  'supabase functions deploy',
  '--use-api',
  'supabase secrets set',
  'OPENAI_API_KEY="$OPENAI_API_KEY"',
  "external_generation_enabled = TRUE",
  "external_generation_enabled = FALSE",
  'supabase/tests/pr08_mcp_oauth_smoke.sh',
  'supabase/tests/pr25_render_edge_smoke.sh',
]) {
  expect(workflow, required, 'manual staging deployment contract')
}

for (const forbidden of [
  '\n  push:',
  '\n  pull_request:',
  '\n  schedule:',
  'default: deploy',
  'default: enable',
]) {
  forbid(workflow, forbidden, 'no automatic or paid-by-default activation')
}

const inputSection = workflow.split('jobs:')[0]
for (const secretName of [
  'SUPABASE_ACCESS_TOKEN:',
  'SUPABASE_DB_PASSWORD:',
  'STAGING_SUPABASE_DB_URL:',
  'OPENAI_API_KEY:',
]) {
  forbid(inputSection, secretName, 'secrets must not be workflow inputs')
}

for (const required of [
  '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
  '${{ secrets.SUPABASE_DB_PASSWORD }}',
  '${{ secrets.STAGING_SUPABASE_DB_URL }}',
  '${{ secrets.OPENAI_API_KEY }}',
]) {
  expect(workflow, required, 'GitHub Environment secret binding')
}

for (const required of [
  'Market Resolver did not contain',
  'build-mcp-server',
  'plan — default',
  'There is no implicit enable after deploy',
  'Actual beta activation still requires',
]) {
  expect(docs, required, 'staging activation documentation')
}

expect(roadmap, '| PR-27 |', 'roadmap PR-27 milestone')

if (pkg.scripts?.['activation:pr27'] !== 'node scripts/pr27-staging-activation-check.mjs') {
  throw new Error('PR-27 staging gate script missing from package.json')
}

console.log('PR-27 staging activation boundaries passed.')
