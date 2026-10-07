import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`PR-20 invariant missing: ${label}`)
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`PR-20 forbidden: ${label}`)
}

const migration = read('supabase/migrations/20261007231000_pr20_public_snapshot_consent.sql')
const test = read('supabase/tests/pr20_public_snapshot_consent_integration.sh')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const docs = read('docs/PR20_PUBLIC_SNAPSHOT_CONSENT.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_publication_request', 'snapshot request table')
expect(migration, 'comic_publication_consent', 'per-user consent table')
expect(migration, 'through_message_id', 'message-bound snapshot cutoff')
expect(migration, 'comic_propose_public_snapshot', 'proposal RPC')
expect(migration, 'comic_set_public_snapshot_consent', 'consent RPC')
expect(migration, 'comic_cancel_public_snapshot_request', 'cancel RPC')
expect(migration, 'publication_enabled BOOLEAN', 'explicit disabled publication capability')
expect(migration, 'comic_public_snapshot_cancel_on_block', 'block invalidation trigger')
expect(migration, 'comic_public_snapshot_cancel_on_deletion_request', 'deletion invalidation trigger')
expect(test, 'future message excluded', 'future-message exclusion')
expect(test, 'publication request existence oracle', 'foreign/unknown anti-oracle')
expect(test, 'CANCELLED_BY_BLOCK', 'block cancellation assertion')
expect(test, 'CANCELLED_BY_DELETE', 'deletion cancellation assertion')
expect(test, "p.proname LIKE 'comic_publish%'", 'absence of publication RPC')
expect(mcp, "'list_public_snapshot_requests'", 'MCP list tool')
expect(mcp, "'propose_public_snapshot'", 'MCP proposal tool')
expect(mcp, "'set_public_snapshot_consent'", 'MCP consent tool')
expect(mcp, "'cancel_public_snapshot_request'", 'MCP cancel tool')
expect(mcp, 'publication remains disabled', 'MCP no-publication warning')
expect(docs, 'not** a permanent conversation-wide switch', 'snapshot-scoped documentation')
expect(roadmap, '| PR-20 |', 'roadmap PR-20 row')
expect(ci, '20261007231000_pr20_public_snapshot_consent.sql', 'CI applies PR-20 migration')
expect(ci, 'pr20_public_snapshot_consent_integration.sh', 'CI runs PR-20 integration')
expect(ci, 'npm run privacy:pr20', 'CI runs PR-20 static gate')

forbid(mcp, "'publish_public_snapshot'", 'publication tool must not exist')
forbid(mcp, "'publish_conversation'", 'conversation publication tool must not exist')

console.log('PR-20 snapshot-scoped bilateral sharing consent boundary passed.')
