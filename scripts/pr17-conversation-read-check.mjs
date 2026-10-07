import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-17 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261007182000_pr17_conversation_read_boundary.sql')
const test = read('supabase/tests/pr17_conversation_read_integration.sh')
const web = read('components/ComicDirectMessages.js')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const docs = read('docs/PR17_CONVERSATION_READ_BOUNDARY.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_read_conversation_messages', 'explicit message-read RPC')
expect(migration, 'me UUID := auth.uid()', 'server-derived caller identity')
expect(migration, 'membership.user_id = me', 'membership authorization')
expect(migration, "RAISE EXCEPTION 'conversation_forbidden'", 'uniform forbidden error')
expect(migration, 'p_limit > 1000', 'bounded read')
expect(migration, 'ORDER BY recent.created_at ASC, recent.id ASC', 'chronological output')
expect(migration, 'GRANT EXECUTE ON FUNCTION public.comic_read_conversation_messages(UUID, INTEGER)', 'authenticated RPC grant')

expect(test, 'conversation existence oracle detected', 'foreign/nonexistent indistinguishability test')
expect(test, 'foreign conversation read unexpectedly succeeded', 'foreign IDOR rejection')
expect(test, 'unknown conversation read unexpectedly succeeded', 'unknown UUID rejection')
expect(test, 'oversized message read unexpectedly succeeded', 'read bound test')

expect(web, "'comic_read_conversation_messages'", 'web uses explicit read RPC')
expect(mcp, "'comic_read_conversation_messages'", 'MCP uses explicit read RPC')
expect(mcp, "selectedConversationId: conversationId || null", 'selected ID emitted only after successful RPC path')

if (web.includes(".from('comic_message')")) {
  throw new Error('PR-17 invariant missing: web must not bypass explicit conversation-read RPC')
}

expect(docs, 'conversation-existence oracle', 'documented anti-enumeration boundary')
expect(roadmap, '| PR-17 |', 'roadmap PR-17 row')
expect(ci, '20261007182000_pr17_conversation_read_boundary.sql', 'CI applies PR-17 migration')
expect(ci, 'pr17_conversation_read_integration.sh', 'CI runs PR-17 integration')
expect(ci, 'npm run privacy:pr17', 'CI runs PR-17 static gate')

console.log('PR-17 explicit conversation-read boundaries passed.')
