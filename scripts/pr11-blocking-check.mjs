import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-11 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261006193000_pr11_blocking_boundary.sql')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const ci = read('.github/workflows/ci.yml')
const roadmap = read('ROADMAP.md')
const docs = read('docs/PR11_BLOCKING_BOUNDARY.md')

expect(migration, 'CREATE TABLE IF NOT EXISTS public.comic_user_block', 'block table')
expect(migration, 'ALTER TABLE public.comic_user_block ENABLE ROW LEVEL SECURITY', 'block RLS')
expect(migration, 'comic_user_block_select_own', 'own-block select policy')
expect(migration, 'REVOKE ALL ON TABLE public.comic_user_block FROM anon, authenticated', 'no direct writes')
expect(migration, 'CREATE OR REPLACE FUNCTION public.comic_block_user', 'block RPC')
expect(migration, 'CREATE OR REPLACE FUNCTION public.comic_unblock_user', 'unblock RPC')
expect(migration, 'CREATE OR REPLACE FUNCTION public.comic_list_blocked_users', 'block-list RPC')
expect(migration, "RAISE EXCEPTION 'interaction_blocked'", 'fail-closed interaction gate')
expect(migration, 'public.comic_enqueue_generation_for_message(', 'PR-05 enqueue preserved')
expect(migration, 'b.blocker_id = me AND b.blocked_id = u.id', 'search hides users blocked by caller')
expect(migration, 'b.blocker_id = u.id AND b.blocked_id = me', 'search hides users blocking caller')

expect(mcp, "'list_blocked_users'", 'MCP block-list tool')
expect(mcp, "'block_user'", 'MCP block tool')
expect(mcp, "'unblock_user'", 'MCP unblock tool')
expect(mcp, "supabase.rpc('comic_block_user'", 'MCP routes block through RPC')
expect(mcp, "supabase.rpc('comic_unblock_user'", 'MCP routes unblock through RPC')

expect(ci, '20261006193000_pr11_blocking_boundary.sql', 'CI applies PR-11 migration')
expect(ci, 'pr11_blocking_integration.sh', 'CI runs PR-11 integration')
expect(ci, 'npm run safety:pr11', 'CI runs PR-11 static gate')
expect(roadmap, '| PR-11 |', 'roadmap PR-11 row')
expect(docs, 'Existing history is preserved', 'documented history semantics')
expect(docs, 'does not delete', 'documented non-deletion boundary')

console.log('PR-11 beta safety blocking boundaries passed.')
