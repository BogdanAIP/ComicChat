import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-13 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261006202000_pr13_abuse_reports.sql')
const test = read('supabase/tests/pr13_abuse_report_integration.sh')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const panel = read('components/ComicPanel.js')
const chat = read('components/ComicDirectMessages.js')
const docs = read('docs/PR13_ABUSE_REPORTING.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'CREATE TABLE IF NOT EXISTS public.comic_abuse_report', 'report table')
expect(migration, 'ALTER TABLE public.comic_abuse_report ENABLE ROW LEVEL SECURITY', 'report RLS')
expect(migration, 'comic_abuse_report_select_own', 'reporter-only select policy')
expect(migration, 'REVOKE ALL ON TABLE public.comic_abuse_report FROM anon, authenticated', 'no direct report writes')
expect(migration, 'CREATE OR REPLACE FUNCTION public.comic_report_message', 'report RPC')
expect(migration, 'CREATE OR REPLACE FUNCTION public.comic_list_my_reports', 'own-report list RPC')
expect(migration, 'JOIN public.comic_membership AS mine', 'private-message membership check')
expect(migration, "RAISE EXCEPTION 'cannot_report_own_message'", 'self-report rejection')
expect(migration, "RAISE EXCEPTION 'report_nonce_conflict'", 'idempotency conflict boundary')
expect(migration, 'UNIQUE (reporter_id, message_id)', 'one user report per message')

expect(test, 'non-member reported a message from another private conversation', 'IDOR integration coverage')
expect(test, 'authenticated role unexpectedly has direct INSERT on comic_abuse_report', 'direct-write denial coverage')

expect(mcp, "'report_message'", 'MCP report tool')
expect(mcp, "'list_my_reports'", 'MCP own-report list tool')
expect(mcp, "supabase.rpc('comic_report_message'", 'MCP uses report RPC')
expect(mcp, 'destructiveHint: true', 'MCP report requires high-impact treatment')

expect(panel, '!preview && !mine && onReport', 'only incoming persisted panels expose report action')
expect(chat, "supabase.rpc('comic_report_message'", 'web uses report RPC')
expect(chat, 'setReportRequestId(makeUuid())', 'stable report request UUID starts with target')
expect(chat, 'reportDetails.trim() || null', 'details normalization')
expect(chat, 'event.target.value.slice(0, 1000)', 'web details cap')
expect(chat, 'setReportStatus(t.reportFailed)', 'localized retry-safe user message')

expect(docs, 'reported user cannot enumerate', 'documented reporter privacy')
expect(docs, 'does not automatically punish', 'documented moderation boundary')
expect(roadmap, '| PR-13 |', 'roadmap PR-13 row')
expect(ci, '20261006202000_pr13_abuse_reports.sql', 'CI applies PR-13 migration')
expect(ci, 'pr13_abuse_report_integration.sh', 'CI runs PR-13 integration')
expect(ci, 'npm run safety:pr13', 'CI runs PR-13 static gate')

console.log('PR-13 private abuse reporting boundaries passed.')
