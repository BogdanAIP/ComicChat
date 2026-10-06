import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`PR-10 gate: missing ${label}: ${needle}`)
  }
}

const workflow = read('.github/workflows/production-preflight.yml')
const readme = read('README.md')
const roadmap = read('ROADMAP.md')
const env = read('.env.example')
const doc = read('docs/PR10_PRODUCTION_ACTIVATION.md')
const pkg = JSON.parse(read('package.json'))

for (const required of [
  'workflow_dispatch:',
  'Public HTTPS ComicChat MCP endpoint',
  'https://*)',
  'Refusing placeholder endpoint',
  'supabase/tests/pr08_mcp_oauth_smoke.sh "$COMICCHAT_MCP_URL"',
]) {
  assertIncludes(workflow, required, 'manual production smoke')
}

for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY']) {
  if (workflow.includes(forbidden)) {
    throw new Error(`PR-10 gate: production preflight must stay manual and credential-minimal: ${forbidden}`)
  }
}

for (const required of [
  'PR-01…PR-09',
  'Production-развёртывание',
  'реальное подключение плагина в ChatGPT ещё не подтверждены',
]) {
  assertIncludes(readme, required, 'truthful repository status')
}

assertIncludes(roadmap, '| PR-10 | Production activation preflight + manual HTTPS MCP smoke | PR-09 |', 'roadmap PR-10')
assertIncludes(env, 'COMICCHAT_MCP_URL=https://your-project-id.supabase.co/functions/v1/comicchat-mcp', 'documented MCP operations URL')

for (const required of [
  'не доказывает',
  'двух независимых ComicChat-аккаунтов',
  'реальном ChatGPT',
  'CSP',
  'plugin.json',
]) {
  assertIncludes(doc, required, 'activation limitations/checklist')
}

if (pkg.scripts?.['activation:pr10'] !== 'node scripts/pr10-production-readiness-check.mjs') {
  throw new Error('PR-10 gate: activation:pr10 script missing or changed')
}

console.log('PR-10 production activation boundaries: PASS')
