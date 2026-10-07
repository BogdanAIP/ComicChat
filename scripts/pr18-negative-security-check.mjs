import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`PR-18 invariant missing: ${label}`)
}

const db = read('supabase/tests/pr18_negative_security_matrix.sh')
const realtime = read('supabase/tests/pr18_realtime_negative_security.mjs')
const oauth = read('supabase/tests/pr08_mcp_oauth_smoke.sh')
const docs = read('docs/PR18_NEGATIVE_SECURITY_MATRIX.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

for (const marker of [
  'read existence oracle',
  'read-receipt existence oracle',
  'delivery-receipt existence oracle',
  'send existence oracle',
  'report-message existence oracle',
]) expect(db, marker, marker)

expect(db, "42501:conversation_forbidden", 'uniform conversation error')
expect(db, "42501:report_message_forbidden", 'uniform report error')
expect(realtime, 'foreign user topic', 'foreign user-topic rejection')
expect(realtime, 'foreign conversation topic', 'foreign conversation-topic rejection')
expect(realtime, 'anonymous private conversation topic', 'anonymous topic rejection')
expect(realtime, 'CLIENT_INJECT', 'client Broadcast injection attempt')
expect(oauth, 'definitely-not-a-valid-jwt', 'malformed bearer negative check')
expect(oauth, 'Expected malformed bearer MCP initialize to return 401', 'malformed bearer assertion')
expect(docs, 'test-hardening only', 'test-only scope')
expect(roadmap, '| PR-18 |', 'roadmap milestone')
expect(ci, 'pr18_negative_security_matrix.sh', 'PostgreSQL matrix in CI')
expect(ci, 'pr18_realtime_negative_security.mjs', 'Realtime matrix in CI')
expect(ci, 'npm run security:pr18', 'static PR-18 gate in CI')

console.log('PR-18 negative-security matrix boundaries passed.')
