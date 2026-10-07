import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-23 invariant missing: ${label}`)
  }
}

const test = read('supabase/tests/pr23_mcp_two_account_integration.mjs')
const docs = read('docs/PR23_MCP_TWO_ACCOUNT_ISOLATION.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')
const pkg = read('package.json')

expect(test, '/auth/v1/signup', 'ordinary fixture signup')
expect(test, '/auth/v1/token?grant_type=password', 'independent user sign-in')
expect(test, "method: 'tools/call'", 'actual MCP tool transport')
expect(test, "authorization: `Bearer ${token}`", 'per-user bearer token')
expect(test, "'comicchat_profile'", 'profile identity check')
expect(test, "'open_direct_conversation'", 'MCP conversation creation')
expect(test, "'send_message'", 'MCP send')
expect(test, "'get_messages'", 'MCP read')
expect(test, 'foreignReadSurface', 'foreign conversation rejection surface')
expect(test, 'unknownReadSurface', 'unknown conversation rejection surface')
expect(test, 'MCP conversation existence oracle detected', 'transport anti-oracle comparison')
expect(test, "'open_comicchat_app'", 'focused app IDOR check')
expect(test, "'export_my_data'", 'export isolation')
expect(test, 'C export leaked A-B conversation data', 'negative export assertion')
expect(test, 'PR-23 authenticated MCP two-account isolation checks passed.', 'success marker')

if (/console\.log\([^\n]*(token|password|anonKey|dbUrl)/i.test(test)) {
  throw new Error('PR-23 invariant missing: credentials must not be logged')
}

expect(docs, 'local/CI acceptance test', 'local-only scope')
expect(docs, 'No database-admin credential is sent to the MCP endpoint', 'fixture privilege boundary')
expect(docs, 'does not:', 'explicit non-goals')
expect(roadmap, '| PR-23 |', 'roadmap PR-23 row')
expect(ci, 'pr23_mcp_two_account_integration.mjs', 'MCP two-account test in CI')
expect(ci, 'npm run acceptance:pr23', 'static PR-23 gate in CI')
expect(pkg, '"acceptance:pr23"', 'package script')

console.log('PR-23 authenticated MCP two-account acceptance boundary passed.')
