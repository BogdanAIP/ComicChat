import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expect(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`PR-15 invariant missing: ${label}`)
  }
}

const migration = read('supabase/migrations/20261007163000_pr15_self_service_data_export.sql')
const test = read('supabase/tests/pr15_data_export_integration.sh')
const chat = read('components/Settings.js') + read('components/ComicDirectMessages.js') + read('utils/translations.js')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const docs = read('docs/PR15_DATA_EXPORT.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_export_my_data()', 'authenticated export RPC')
expect(migration, 'me UUID := auth.uid()', 'caller identity derives from auth.uid')
expect(migration, "WHERE mine.user_id = me", 'conversation membership scoping')
expect(migration, "WHERE r.reporter_id = me", 'reporter-only report export')
expect(migration, "WHERE j.sender_id = me", 'sender-only generation-job export')
expect(migration, "WHERE l.sender_id = me", 'sender-only usage-ledger export')
expect(migration, "GRANT EXECUTE ON FUNCTION public.comic_export_my_data() TO authenticated", 'authenticated-only RPC grant')

if (migration.includes("'lease_token'")) {
  throw new Error('PR-15 invariant missing: worker lease_token must not be exported')
}

expect(test, 'unrelated conversation leaked', 'cross-conversation isolation assertion')
expect(test, 'other sender generation job leaked', 'sender billing isolation assertion')
expect(test, 'internal worker lease token field leaked', 'worker-secret omission assertion')

expect(chat, "supabase.rpc('comic_export_my_data')", 'web export uses RPC')
expect(chat, "new Blob([JSON.stringify(data, null, 2)]", 'web produces local JSON download')
expect(chat, 'Export my data', 'web export action')
expect(mcp, "'export_my_data'", 'MCP read-only export tool')
expect(mcp, 'private conversation history', 'MCP privacy warning')
expect(docs, 'does **not** include', 'documented omission boundary')
expect(roadmap, '| PR-15 |', 'roadmap PR-15 row')
expect(ci, '20261007163000_pr15_self_service_data_export.sql', 'CI applies PR-15 migration')
expect(ci, 'pr15_data_export_integration.sh', 'CI runs PR-15 integration')
expect(ci, 'npm run privacy:pr15', 'CI runs PR-15 static gate')

console.log('PR-15 self-service data-export boundaries passed.')
