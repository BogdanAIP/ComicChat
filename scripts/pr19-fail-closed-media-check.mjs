import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`PR-19 invariant missing: ${label}`)
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`PR-19 forbidden: ${label}`)
}

const migration = read('supabase/migrations/20261007223000_pr19_fail_closed_media.sql')
const test = read('supabase/tests/pr19_fail_closed_media_integration.sh')
const mcp = read('supabase/functions/comicchat-mcp/index.ts')
const web = read('components/ComicDirectMessages.js')
const docs = read('docs/PR19_FAIL_CLOSED_MEDIA.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(migration, 'comic_generation_output_media_guard', 'descriptor trigger guard')
expect(migration, 'media_locator_not_enabled', 'media locator rejection')
expect(migration, 'output_descriptor_too_large', 'descriptor size bound')
expect(migration, 'comic_get_media_capabilities', 'media capabilities RPC')
expect(migration, 'public_asset_urls_enabled', 'public URL capability')
expect(test, 'public_url unexpectedly persisted', 'public URL integration rejection')
expect(test, 'object_key unexpectedly persisted', 'object-key integration rejection')
expect(test, 'false|false|false|false|none|65536', 'disabled capability assertion')
expect(mcp, "'get_media_capabilities'", 'MCP media capability tool')
expect(mcp, 'media storage and public media URLs are disabled', 'MCP fail-closed description')
forbid(web, 'supabase.storage', 'secure web path must not use Supabase Storage')
forbid(web, 'getPublicUrl', 'secure web path must not create public URLs')
forbid(web, 'fileUpload', 'secure web path must not use legacy upload helper')
expect(docs, 'does not create a storage bucket', 'documented media non-goal')
expect(roadmap, '| PR-19 |', 'roadmap PR-19 row')
expect(ci, '20261007223000_pr19_fail_closed_media.sql', 'CI applies PR-19 migration')
expect(ci, 'pr19_fail_closed_media_integration.sh', 'CI runs PR-19 integration')
expect(ci, 'npm run security:pr19', 'CI runs PR-19 static gate')

console.log('PR-19 fail-closed media boundary passed.')
