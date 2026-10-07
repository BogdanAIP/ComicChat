import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-16 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261007174500_pr16_deletion_request_boundary.sql')
const test = read('supabase/tests/pr16_deletion_request_integration.sh')
const chat = read('components/ComicDirectMessages.js')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const docs = read('docs/PR16_DELETION_REQUEST.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_account_state', 'account-state table')
expect(migration, "status IN ('active', 'deletion_requested')", 'bounded deletion state')
expect(migration, 'ON DELETE RESTRICT', 'hard-delete cascade guard')
expect(migration, 'comic_request_account_deletion()', 'request RPC')
expect(migration, 'comic_cancel_account_deletion()', 'cancel RPC')
expect(migration, 'comic_get_my_account_state()', 'status RPC')
expect(migration, "RAISE EXCEPTION 'account_deletion_pending'", 'caller interaction stop')
expect(migration, "RAISE EXCEPTION 'account_unavailable'", 'partner interaction stop')
expect(migration, 'pg_advisory_xact_lock', 'PR-14 sender lock preserved')
expect(migration, "recent_message_count >= 30", 'PR-14 rate limit preserved')
expect(migration, "RAISE EXCEPTION 'client_nonce_conflict'", 'nonce conflict preserved')

expect(test, 'raw auth-user deletion unexpectedly bypassed shared-history guard', 'raw auth delete guard test')
expect(test, 'new message to deletion-requested partner unexpectedly succeeded', 'partner send isolation')
expect(test, 'deletion-requested sender unexpectedly sent a new message', 'sender send isolation')
expect(test, 'interaction restored after cancel', 'reversible interaction test')

expect(chat, "supabase.rpc('comic_get_my_account_state')", 'web loads deletion state')
expect(chat, "'comic_request_account_deletion'", 'web request action')
expect(chat, "'comic_cancel_account_deletion'", 'web cancel action')
expect(chat, 'Request account deletion', 'web request label')
expect(chat, 'Cancel deletion request', 'web cancel label')

expect(mcp, "'get_account_deletion_status'", 'MCP state tool')
expect(mcp, "'request_account_deletion'", 'MCP request tool')
expect(mcp, "'cancel_account_deletion'", 'MCP cancel tool')
expect(mcp, 'shared history is retained', 'MCP deletion warning')

expect(docs, 'two-phase process', 'documented deletion model')
expect(docs, 'does not', 'documented non-goals')
expect(roadmap, '| PR-16 |', 'roadmap PR-16 row')
expect(ci, '20261007174500_pr16_deletion_request_boundary.sql', 'CI applies PR-16 migration')
expect(ci, 'pr16_deletion_request_integration.sh', 'CI runs PR-16 integration')
expect(ci, 'npm run privacy:pr16', 'CI runs PR-16 static gate')

console.log('PR-16 account deletion-request boundaries passed.')
