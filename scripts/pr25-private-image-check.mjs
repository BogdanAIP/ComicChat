import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const expect = (source, needle, label) => {
  if (!source.includes(needle)) {
    throw new Error(`PR-25 invariant missing: ${label}`)
  }
}
const forbid = (source, needle, label) => {
  if (source.includes(needle)) {
    throw new Error(`PR-25 forbidden: ${label}`)
  }
}

const migration = read('supabase/migrations/20261007235500_pr25_private_image_generation.sql')
const edge = read('supabase/functions/comicchat-render/index.ts') + read('supabase/functions/_shared/comic-image-worker.ts')
const panel = read('components/ComicPanel.js')
const web = read('components/ComicDirectMessages.js')
const config = read('supabase/config.toml')
const dbTest = read('supabase/tests/pr25_generation_provider_integration.sh')
const mediaTest = read('supabase/tests/pr25_private_media_integration.mjs')
const docs = read('docs/PR25_PRIVATE_IMAGE_GENERATION.md')
const roadmap = read('ROADMAP.md')
const ci = read('.github/workflows/ci.yml')

expect(
  migration,
  'external_generation_enabled BOOLEAN NOT NULL DEFAULT FALSE',
  'external provider default-off gate'
)
expect(migration, "'comicchat-sponsored-beta'", 'explicit sponsored beta billing source')
expect(
  migration,
  'comic_claim_generation_job_for_message',
  'exact-message service-role claim'
)
expect(migration, "VALUES (''comicchat-art'', ''comicchat-art'', FALSE)", 'private storage bucket')
expect(migration, 'comicchat_private_art_select', 'private media SELECT policy')
expect(migration, 'public.comic_is_member(', 'conversation membership storage authorization')
expect(migration, 'client_upload_enabled BOOLEAN', 'client upload capability remains explicit')
expect(migration, 'public_asset_urls_enabled BOOLEAN', 'public URL capability remains explicit')

expect(edge, "'npm:openai@7.28.0'", 'pinned official OpenAI SDK')
expect(edge, 'openai.images.generate({', 'official Images API generation call')
expect(edge, "output_format: 'webp'", 'WebP provider output')
expect(edge, "quality: 'low'", 'closed-beta low quality setting')
expect(edge, 'EdgeRuntime.waitUntil(', 'background render dispatch')
expect(edge, ".from('comic_generation_job')", 'sender-RLS generation ownership check')
expect(edge, "'comic_claim_generation_job_for_message'", 'exact-message worker claim')
expect(edge, ".from(BUCKET)\n      .upload(", 'trusted private Storage upload')
expect(edge, "p_billable_units: 1", 'one provider image usage unit')
expect(edge, "p_cost_microunits: 0", 'sponsored-beta end-user cost accounting')
expect(edge, "p_error_detail: null", 'provider errors do not persist raw private details')
forbid(edge, 'getPublicUrl', 'public media URL helper')
forbid(edge, 'createSignedUrl', 'signed media URL helper')
forbid(edge, 'console.log(', 'worker must not emit general logs')
forbid(edge, 'console.error(error', 'worker must not log raw provider errors')
forbid(edge, 'console.error(encoded', 'worker must not log image payload')
forbid(edge, 'console.error(message.', 'worker must not log private message fields')

expect(panel, ".from('comicchat-art')", 'ComicPanel private bucket download')
expect(panel, '.download(privateArtKey)', 'authenticated private download')
expect(panel, 'URL.createObjectURL(data)', 'local blob URL rendering')
forbid(panel, 'getPublicUrl', 'ComicPanel public URL helper')
forbid(panel, 'createSignedUrl', 'ComicPanel signed URL helper')

expect(web, "betaSafety?.external_generation_enabled", 'web dispatch provider gate')
expect(web, ".invoke('comicchat-render'", 'sender render dispatch')
expect(web, 'mediaStorageEnabled={Boolean(betaSafety?.media_storage_enabled)}', 'dynamic media capability')
expect(web, 'does not charge your ChatGPT plan', 'billing-source disclosure')

expect(config, '[storage]\nenabled = true', 'local private Storage enabled')
expect(config, '[functions.comicchat-render]', 'render function config')
expect(config, 'verify_jwt = false', 'function performs explicit auth validation')

expect(dbTest, 'default stays mock', 'default provider regression')
expect(dbTest, 'openai-image|comicchat-sponsored-beta', 'explicit activation regression')
expect(mediaTest, "getBucket('comicchat-art')", 'private bucket integration')
expect(mediaTest, 'conversation partner could not download private comic art', 'A/B access test')
expect(mediaTest, 'foreign authenticated user unexpectedly downloaded', 'foreign-user denial')
expect(mediaTest, 'authenticated browser unexpectedly uploaded', 'browser write denial')

expect(docs, 'Reuse decision', 'reuse-first decision documentation')
expect(docs, 'disabled by default', 'default-off provider documentation')
expect(docs, 'does **not** claim', 'no ChatGPT plan billing claim')
expect(roadmap, '| PR-25 |', 'roadmap PR-25 row')

expect(ci, 'npm run media:pr25', 'CI static gate')
expect(ci, '20261007235500_pr25_private_image_generation.sql', 'CI applies migration')
expect(ci, 'pr25_generation_provider_integration.sh', 'CI provider integration')
expect(ci, 'pr25_private_media_integration.mjs', 'CI private media integration')
expect(ci, 'pr25_render_edge_smoke.sh', 'CI render Edge Runtime smoke')

console.log('PR-25 private image generation boundaries passed.')
