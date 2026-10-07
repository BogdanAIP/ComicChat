import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-22 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261007234500_pr22_beta_safety_disclosure.sql')
const test = read('supabase/tests/pr22_beta_safety_disclosure_integration.sh')
const docs = read('docs/PR22_BETA_SAFETY_OPERATIONS.md')
const web = read('components/ComicDirectMessages.js')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_get_beta_safety_status()', 'authenticated disclosure RPC')
expect(migration, "'closed_beta'::TEXT", 'closed-beta stage')
expect(migration, "'mock'::TEXT", 'mock provider disclosure')
expect(migration, 'message_rate_limit_per_minute INTEGER', 'rate-limit disclosure')
expect(migration, 'GRANT EXECUTE ON FUNCTION public.comic_get_beta_safety_status()', 'authenticated grant')

expect(test, 'closed_beta|mock|f|f|f|f|f|f|t|t|t|t|30|t', 'exact disclosed state')
expect(test, 'unauthenticated beta safety status unexpectedly succeeded', 'auth rejection')
expect(test, 'comic_get_media_capabilities', 'media capability cross-check')
expect(test, 'comic_get_my_account_state', 'hard-delete cross-check')

expect(docs, 'No retention duration is configured or claimed', 'no invented retention duration')
expect(docs, 'No external image-generation provider is enabled', 'provider notice')
expect(docs, 'Incident response runbook', 'incident response documentation')
expect(docs, 'universal notification deadline', 'no invented legal deadline')
expect(docs, 'claim legal compliance', 'no legal-compliance claim')
expect(docs, 'does not:', 'explicit non-goals')

expect(web, "'comic_get_beta_safety_status'", 'web loads safety disclosure')
expect(web, 'Closed beta limits', 'web disclosure heading')
expect(web, "betaSafety.retention_duration_defined ? 'is defined' : 'is not defined'", 'web retention disclosure derives from RPC state')
expect(web, "betaSafety.generation_provider || 'unknown'", 'web provider disclosure derives from RPC state')
expect(mcp, "'get_beta_safety_status'", 'MCP disclosure tool')
expect(mcp, 'retention duration is not defined', 'MCP disclosure description')

expect(roadmap, '| PR-22 |', 'roadmap PR-22 row')
expect(ci, '20261007234500_pr22_beta_safety_disclosure.sql', 'CI applies disclosure migration')
expect(ci, 'pr22_beta_safety_disclosure_integration.sh', 'CI runs disclosure integration')
expect(ci, 'npm run safety:pr22', 'CI runs PR-22 static gate')

console.log('PR-22 closed-beta safety disclosure boundaries passed.')
